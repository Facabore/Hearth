# ADR 0006 — A client-first single-page app instead of server rendering

- Status: Accepted (2026-10-28), supersedes the rendering half of [ADR 0003](0003-web-ui-talks-to-the-api-through-a-generated-client.md) and amends [ADR 0004](0004-web-ui-testing-and-performance-gates.md)
- Issues: #196 (the measurements), #199 (the migration)

## Context

The owner, testing the deployed MVP on hearth-test, said the app felt slow ("¿Por qué van tan lenta la app? para abrir al editar, cualquier acción demora un montón"). The measurements, taken on 2026-10-27 and 2026-10-28 on the owner's own session:

- Every tap waits on a server render before anything changes on screen. Measured on a desktop at 58 ms round trip: Movimientos 400 ms, opening a movement 238 ms, Editar 335 ms and Plan 355 ms until the screen changed. On a phone, with mobile latency and a CPU about 4× slower, that is roughly 0.7 to 1.5 s per tap.
- Each server render fans out into 5 to 8 loopback calls to `/api/v1`, each validating the session again, so a screen costs 170 to 390 ms on the server. When several renders coincide, as at sign-in or during prefetching, single calls reach 1.3 to 2.6 s.
- Prefetching does not help. Opening a space fires 11 route prefetches, and "Editar" was prefetched three times. Next.js's router treats prefetched dynamic data as stale at once, so the tap renders again on the server anyway.
- Tuning inside the model was tried or weighed and fell short:
  - Parallel loads (c4bf095) shortened the server rounds.
  - Route skeletons had to be rebuilt to keep 404s and budgets (#196).
  - Reusing prefetched data for 30 s was rejected by the owner: "Los 30s cargados es una estupidez, no sirve de nada, literal."

Hearth is an app people sign into. It needs no search indexing and gains nothing from a first render on the server. ADR 0003 already planned a PWA and then a Capacitor shell, and a Node server behind every screen rules both out.

The owner's ruling: "Necesitamos fluidez y cambios respectivos para cada cosa. La C es útil y nos ayuda con lo que necesitamos si lo que esperamos es fluidez, creo que el problema es tratar de ser SSR sin necesitarlo."

## Decision

The web UI becomes a client-rendered single-page app, and the server leaves the path of every tap.

- **Build:** Vite, already in the repo for Vitest, builds a static SPA with React 19 that is split per route.
- **Routing:** TanStack Router, with typed paths and search params (`?tx=`, `?period=`, `returnTo`). Route guards (`beforeLoad`) replace `src/proxy.ts` for redirects such as sign-in, `safeNext`, `safeReturnTo` and `?from=`. The API still authorizes every request; a guard is only navigation.
- **Data:** TanStack Query owns server state.
  - Every read is a query keyed by module and parameters. A screen paints at once from the cache and refreshes in the background (stale-while-revalidate).
  - Every write is a mutation with an optimistic update and a rollback when the API refuses. Afterwards it invalidates the keys it touched: "cambios respectivos para cada cosa".
  - Routes prefetch on intent, through the query cache, so a prefetch is never wasted.
- **The API is unchanged.** It is the same `/api/v1`, the same generated client (`openapi-fetch` over `schema.d.ts`), the same contract and the same cookie session on the same origin. Next.js keeps serving only the route handlers until a later decision moves them. Caddy serves the SPA's static files, with `index.html` as the fallback for app paths, and sends `/api/*` to the app.
- **Texts and formats:** `use-intl`, the framework-agnostic core of next-intl, keeps `src/i18n/messages/{es,en}.json` and `useTranslations` unchanged. `src/shared/ui/format/` stays the only formatter (D23, P121).
- **Containers and presentational components (P127):** a container becomes a query hook plus a component. Presentational components move as they are.
- **Native apps:** a native shell later points the same client at an absolute API origin and uses Better Auth's Bearer plugin, which is already installed. The SPA needs no server of its own.
- Library versions are pinned in `docs/stack-versions.md` when the first slice lands, following its two-week rule.

## Implementation (slice 1, 2026-10-27)

- **The components move unchanged.** `vite.spa.config.ts` resolves the components' `next/link`, `next/navigation`, `next/dynamic` and `next-intl` imports to small adapters in `src/spa/next/` over TanStack Router, the query cache and use-intl. `refresh()` invalidates every query and runs the guards again. dependency-cruiser keeps `src/spa/` away from `ui/server.ts`, the server-only API reader and `src/app` (rule `spa-is-client-only`).
- **URLs stay as they are.** The router's base is `/app`; inside it the paths are the Next.js UI's own, so `safeNext`, `safeReturnTo`, `redirectFor` and `activeSpaceOf` (`?from=`) apply unchanged. Search params are read and written as plain strings, a repeated name as a list, like the Next.js pages; TanStack's JSON default would turn `?expired=1` into a number.
- **Guards.** The root `beforeLoad` is `src/proxy.ts`: `redirectFor` decides which paths need a session. The browser cannot read the HttpOnly session cookie, so the guard asks `/api/v1/me` instead. A cached answer is trusted only when it lets the person through, and a redirect is decided only on a fresh one, so a sign-in or sign-out that just happened is never undone by a stale answer. When the person changes, every cached answer except the profile, sign-up's mode and the catalogs is dropped, so nobody paints from the previous person's data.
- **Two clients.** Screens use `browserApi` over the router's location, so a session that ends mid-use goes to the app's own sign-in with `expired=1` (P151). The guards' profile read uses a plain client, where a 401 only means signed out.
- **Texts.** The intl provider waits for the profile, so a signed-in person never sees a frame in the visitor's language, and loads one catalog per language as its own chunk. The catalogs are precompiled like `next.config.ts` does (P134).
- **Serving.** A `web` image (`FROM caddy`, `Caddyfile.web`) holds the build under `/srv/app`. The edge Caddy, bundled or the host's own, proxies `/app` and `/app/*` to it. One image serves both deployments and the edge configuration stays config only.
- **Budgets.** `scripts/spa-budget.mjs` gates the gzip size of the shell (the entry and its static imports) and of each lazy chunk against `tests/performance/spa-budgets.json`, about 3 KiB above the first measurement. The shell measured 115.5 KiB; the Next.js sign-in and home routes have script budgets of 158 to 162 KiB.

## Implementation (slice 2, 2026-10-28): the ledger flow

- **Screens.** The home (`?tx=`, `?joined=`), Movimientos (filters, notice, `?tx=`), the record form and the edit form (conversion and its undo, #195) compose the ledger's existing components over the query cache. A screen is a query hook plus the component (P127): `src/spa/ledger/hooks.ts` builds the props the server containers built. The detail sheet renders beside the list with the app's client, so `TransactionList` and `HomeSummary` stay unchanged.
- **Keys.** Module first, then the space, then the API's own parameters: `["ledger", space, "transactions", query]`, `["ledger", space, "transaction", id]`, `["accounts", space, "active" | "all"]`, `["categories", …]`, `["members", space]`, `["periods", space, from]`, `["reports", space, "lines", period]`.
- **Revalidation.** Route loaders fill the cache and refresh what it holds in the background when a screen is entered or prefetched. They don't refresh when only the address of the screen on display changes, such as opening a sheet or picking a filter, so that costs no reads. Opening a row always refreshes its detail. Mounting a screen never reads again: TanStack Router reuses a prefetch's load for the tap that follows it, so the loader, not the mount, is where a visit refreshes.
- **Writes.** The components keep their submit code and call the client they are given. The app's client runs the ledger's writes as TanStack Query mutations (`src/spa/writes.ts`, `src/spa/ledger/writes.ts`):
  - Delete and Deshacer move the row before the API answers and put it back when the API refuses (P194).
  - The forms wait for the API, because a refusal shows its code next to its field (P118). So an accepted save writes the API's answer, the row and its detail, into the cache before the form leaves. The sheet or list it lands on paints at once, and an optimistic copy hidden behind a waiting form would show nothing sooner.
  - A row is placed in the API's order (P43), only in its period and never under a category or payer filter, which the API decides. Totals are computed on read (D7) and arrive with the background refresh; the UI never computes them.
  - A movement invalidates its space's pages, its accounts (and, from a shared space, the person's personal accounts) and the space's reports. It never invalidates the categories, members, periods, the person or their spaces. A first split with someone also refreshes the spaces, which gain the direct space.
  - The components' `refresh()` after such a save reads nothing. Any other refresh, such as P193's "Cargar la última versión", still reads the screen again.
- **Volver.** The trail, Volver and closing a sheet read the address without the `/app` base (`setAppBase`; the Next.js UI keeps none). The SPA mounts the navigation tracker.
- **Budgets.** The ledger's loaders, its write plans and the mutation runner load beside the screens, not with the shell. So do the tracker and the problem notice with its icons, while the connection error screen stays in the shell and shows offline. The shell's libraries are one chunk (`codeSplitting` group `framework`): split among the new screens they had become a dozen small files, each compressed on its own, 5 KiB more gzip for the same code. The shell measures 116.9 KiB against its 118 KiB budget, unchanged. The home's chunk, a 3 KiB stub in slice 1, now holds the home (12.9 KiB, budget 16); the new chunks have budgets about 3 KiB above their measurement.
- **Gate.** `tests/e2e/spa/ledger.spec.ts` visits Movimientos, a row's sheet and Editar once. It then holds every `/api/v1` request unanswered until its assertions have run, so the second visit to each can show its content only from the cache. It checks that the screens did ask the API again behind (the background refresh), requires each tap to show its content within 300 ms, under the 240 to 420 ms the server-rendered taps measured, and logs the times. Measured on 2026-10-28: 44 to 68 ms on an idle machine, 158 to 182 ms with the unit suites running beside it.

## Implementation (slice 3, 2026-10-28): accounts, categories and settings

- **Screens.** The accounts list, a new account, an account's edit form, the category tree, Settings and New space compose their existing components, unchanged. Settings and New space draw the shell of the space `?from=` names (N3) through the same `ShellFrame` as a space's screens.
- **One client for every component.** In the SPA, `browserApi()` called without a location returns the app's own client (`src/spa/next/api-client.ts`, the same alias mechanism as the `next/*` adapters). A component nested deep in a screen, such as an account's Ocultar confirmation or a category's sheet, therefore writes through the same plans as its screen, and a session that ends mid-use returns to the app's own sign-in (P151). No client is handed down through the components. That includes the ledger's "Cargar más".
- **Plans.** `src/spa/writes-catalog.ts` combines every module's plans. They load with the first signed-in screen, never with the shell.
  - Accounts: an account write invalidates the space's account lists and reports, and the answer replaces the account's own entry.
  - Categories: a category or group write invalidates the space's categories and reports. The tree shows the API's answer by itself.
  - Spaces: a new space joins the person's spaces before the form lands in it, and a rename shows at once.
  - Profile: a profile change replaces the cached profile with the API's answer, so every screen formats again without a read.
- **Accounts' totals.** The accounts query caches the API's whole answer: the list and its totals, computed on read (D7). The other screens select its items from the same read.
- **"Cargar más".** Its rows live in the component's own state, out of the cache. Each ledger write bumps a per-space counter in the cache, and Movimientos starts the list afresh when it changes, so no loaded row outlives a write that changed or removed it.
- **Budgets.** The shell measures 117.9 KiB against its 118 KiB budget, unchanged: about 1 KiB for six route definitions and the client adapter. Slices 4 and 5 add some twenty routes, so their definitions will need to move out of the shell before then.
- **Gate.** `tests/e2e/spa/manage.spec.ts` runs against the real API and scans each screen with axe. It creates an account from the form and finds it on the list, opens the category tree, changes the number format in Settings and finds the new format on the accounts screen, and opens New space inside its shell.

## Implementation (slice 4, 2026-10-28): shared spaces

- **Screens.** Members (`?invite=1`), a member's balance history (`?from=`), balances and settle-up (`?settle=`), and the invitation and claim pages. A personal space has no members, balances or history, so those answer the not-found screen, as the Next.js containers do. The invitation and claim pages hang off an open layout: the public frame without its "already signed in" redirect, since anyone may open them (P157). Dates there use the person's own zone when signed in. Without a profile, they use the installation's default zone, because the SPA reads no server environment (`APP_TIMEZONE`, P182).
- **`ui/screens.ts`.** A module's whole screens, which only the SPA composes, have their own entry. They sit above every module's barrel: the members screen, for example, reaches the balances and through them the ledger, whose forms import the spaces barrel. Exported from `index.ts`, they closed import cycles. dependency-cruiser lets only `src/spa` import a `screens.ts` (`ui-screens-only-for-the-spa`).
- **Plans.**
  - Accepting an invitation or a claim adds the space to the person's spaces before the screen lands in it.
  - Inviting, revoking, adding or removing a guest, a claim link and a role invalidate the space's members (its invitations among them) and its balances.
  - A settle-up is a movement. Every movement now also invalidates the space's balances: in a shared space, each expense changes them.
- **Reads moved out of the shell.** The screens' reads moved from `queries.ts` (the shell's: the profile, sign-up and spaces) to `reads.ts`, which loads with the screens. The slice 3 loaders became lazy too, and the app base moved out of `history.ts`, so declaring it no longer loads the Volver trail. The shell measures 117.8 KiB against its 118 KiB budget, unchanged. The chunks that now carry that code got budgets about 3 KiB above their new measurement: the ledger's sheet, split, record, edit, list and home.
- **Retries.** Only a read that failed for a passing reason is retried: the network, or a 5xx. A 404 or a refusal would answer the same again, so it shows at once.
- **Gate.** `tests/e2e/spa/shared.spec.ts` runs two people against the real API, with axe on every screen. Ana invites, Juan opens the open invitation page in a browser of his own and accepts it, and lands in Household. Ana sees him among the members, records a shared expense, and settles up from the balances' suggestion, which goes away. Then she opens Juan's history.

## Implementation (slice 5, 2026-10-28): the Plan tab and the planner

- **Screens.** The Plan tab's own page (My spending in the personal space, Lines in a shared one, P200) and its views: lines, groups, trend (`?periods=`), fund, members and Próximos (`?days=`). Each takes `?period=`, else the space's period holding today in the person's zone (P205). There are also the planner, its capacities, and a line's editor, new or existing. A view a space does not have is not found. So is a plan or a line that is not there, as the Next.js containers answer.
- **Reads.** One query per report, keyed `["reports", space, kind, params]`: lines, fund contributions, member matrix, spending by group, the line trend, the desktop overview (each part left out when it fails, P216) and, for the person's own views, the unified view, their groups, their trend and their cash flow. The person's own views are keyed under the personal space. A plan is keyed `["plans", space, plan]`, its capacity suggestion under it, and one that cannot be read is null (P208).
- **Plans.** Every write under a space's plans (create or copy, activate, close, capacities, a line and its funding or categories) invalidates the space's plans and reports, and nothing else. Writes now include PUT, which the planner uses. My spending counts the person's share of every space, so a movement in a shared space also invalidates the personal space's reports.
- **Shell.** The `framework` chunk leaves out the parts of TanStack Query only the screens and the saves use: several queries at once, and mutations. With eleven more routes, the shell measures 117.3 KiB against its 118 KiB budget, unchanged. The trend chart stays a lazy chunk of its own (119.6 KiB, budget 123). The Next.js trend route allows 260 KiB in all, about what the SPA's shell, view and chart add up to.
- **Types.** The desktop overview's `Overview` type moves to a client-safe file, as the ledger's `TransactionDetail` did, so `reporting/ui/screens.ts` never reaches the server reader.
- **Gate.** `tests/e2e/spa/plan.spec.ts` runs against the real API, with axe on every screen. It starts a shared space's plan from its Plan tab and lands in the planner, saves the capacities back to it, and opens a new line's editor. Then it opens every view of the shared and the personal space.

## Consequences

- Moving between screens already in the cache costs no network round trip. A screen seen for the first time costs its own API calls only, about 30 to 130 ms each, with no server render on top. Saving updates the screen at once and rolls back with the API's error message if the save is refused.
- The first load downloads the app shell once: there is no server-rendered HTML, so the first paint waits for the script. ADR 0004's route budgets become chunk budgets per route. Lighthouse keeps gating the cold load, and a new gate measures tap-to-content on cached navigation.
- An unknown address inside the app gets the app's own not-found screen with a 200 status, because the SPA's fallback serves every app path. Ruling N1's 404 status still applies to the API and to unknown files.
- Saves no longer need `router.refresh()`, and the Back-button staleness that kept it (#196, L4) goes away, because Back reads the same query cache that every mutation invalidates.
- The route skeletons of #196 and the server containers are dropped at cut-over. Until then the Next.js UI stays live, so nothing regresses mid-migration.
- Migration is by slices, with the SPA served at `/app/` on hearth-test until it reaches parity. Then Caddy points the root at it and the Next.js pages are deleted. The slices are listed in #199.
- Rejected:
  - Staying on server rendering and tuning it, or reusing prefetched data for 30 s (owner, above).
  - Another server-rendering framework (SvelteKit, Remix, Nuxt). Loading data on the server at every navigation is the cost itself, whatever the framework.
  - A React Native (Expo) rewrite. It would replace every screen instead of reusing them, while Capacitor wraps the SPA as it is.
