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
