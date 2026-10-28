# ADR 0003 — The web UI talks to the API through a generated client

- Status: Accepted (2026-10-20); the reads amended 2026-10-28 by [ADR 0006](0006-client-first-single-page-app.md)
- Stories: HU-E9-01, HU-E9-03 (rulings P117, P119, P139)

## Context

D18 makes Next.js the BFF and `/api/v1` the primary contract. The owner plans a PWA and then a Capacitor shell, so every screen must work over the public contract alone. The epic's first notes proposed pages and server actions calling the use cases.

## Decision

- Every screen talks to `/api/v1` through one client generated from `openapi/openapi.snapshot.json`: `openapi-typescript` 7.13.0 types and `openapi-fetch` 0.17.0 at run time (P117).
- Server Components read over loopback HTTP (`INTERNAL_API_ORIGIN`, default `http://127.0.0.1:$PORT`), forwarding only the request's cookie, client address and `accept-language`. Every write runs in the browser against the same endpoints, then `router.refresh()`. There are no server actions. Since the cut-over of #199 there are no Server Components either: the single-page app reads and writes from the browser through the same client (ADR 0006).
- `src/shared/ui/api/schema.d.ts` is committed, generated only from the reviewed snapshot and checked by `pnpm api:check` (P139).
- dependency-cruiser keeps UI code away from the server layers (P119): no module `domain`, `application`, `infrastructure` or `contracts`, no `src/composition`, no server-only packages; a module's ui reaches another's only through `ui/index.ts` (client-safe) or `ui/server.ts` (server containers).

## Consequences

- One contract for every client: the web UI, a PWA or a native shell call the same endpoints.
- Each server read costs one loopback hop.
- The auth throttles keep seeing the real client, because sign-up and sign-in run in the browser.
- Forms do not share Zod schemas with the server: they check only what they need to build a request and show the API's codes next to their fields (P118).
