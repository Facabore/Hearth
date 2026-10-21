# Architecture overview

Hearth is a modular monolith. One Next.js application hosts the versioned HTTP API under `/api/v1`, and a single PostgreSQL database holds the data. This page shows how it is deployed, how a request travels through the code, which modules exist and which rules keep them apart. The source of truth for every decision is the [design spec](../superpowers/specs/2026-10-11-hearth-design.md); this page summarises it and points back to it.

The database has its own page: [data model](data-model.md).

## Deployment

The production stack is Docker Compose on a VPS: Caddy, the `app` container, PostgreSQL, a one-shot `migrate` container and the nightly `backup` container. CI builds the images; the operator pulls them by commit SHA. The steps are in [Deploying Hearth to a VPS](../operations/deploy.md); the definitions are [`compose.yaml`](https://github.com/Facabore/Hearth/blob/development/compose.yaml) and [`Caddyfile`](https://github.com/Facabore/Hearth/blob/development/Caddyfile).

```mermaid
flowchart TB
    web["Web UI (Next.js pages in app, M6)"]
    clients["API clients"]
    mobile["Mobile app (post-MVP)"]

    subgraph vps ["VPS: Docker Compose, private network"]
        caddy["Caddy: only public entry, ports 80 and 443"]
        app["app (Next.js): /api/v1 and the recurrence job, no published port"]
        migrate["migrate: runs migrations, then exits"]
        db[("PostgreSQL: never published")]
        backup["backup: nightly pg_dump at 02:00, keeps 14"]
    end
    offsite["backup-offsite (optional, own network): rclone copy at 03:00"]

    ci["GitHub Actions CI on main: builds the images"]
    ghcr["GHCR images, tagged by commit SHA"]
    remote["Off-site storage: any rclone remote"]

    web -->|HTTPS| caddy
    clients -->|HTTPS| caddy
    mobile -.->|HTTPS| caddy
    caddy -->|"proxy to app:3000"| app
    app -->|SQL| db
    migrate -->|migrations| db
    migrate -->|"must finish first"| app
    ci -->|push| ghcr
    ghcr -->|"compose pull"| app
    ghcr -->|"compose pull"| migrate
    backup -->|"pg_dump, restore drill"| db
    offsite -.->|"reads the backups volume"| backup
    offsite -.->|HTTPS| remote
```

What the files say:

- **Caddy** is the only service that publishes ports (`80`, `443` and `443/udp`). It terminates TLS, compresses responses and proxies everything to `app:3000`. It sets `X-Forwarded-For` to the real peer address, which the sign-in throttles rely on.
- **`app`** publishes no port. It starts only after `migrate` has completed successfully, and it records due recurring transactions itself with an in-process timer ([recurring transactions job](../operations/deploy.md#recurring-transactions-job)).
- **PostgreSQL** is on the internal network only. Its data lives in the `db-data` volume, and its nightly dumps in the `backups` volume.
- **CI** (`.github/workflows/ci.yml`) runs lint, boundary check, typecheck and tests, builds the two images (`hearth` and `hearth-migrator`) and smoke-tests them against PostgreSQL. On a push to `main` it pushes them to GHCR tagged with the commit SHA and `main`. Releases are deployed by setting both image tags in `.env` to the SHA.
- **`backup`** runs `pg_dump` every night at 02:00 in `APP_TIMEZONE` into the `backups` volume and keeps the newest `BACKUP_RETENTION_DAYS` (14) files; `scripts/restore-drill.sh` restores the newest into a scratch database, checks its transaction count and drops it (HU-E8-01, [Backups and restore](../operations/backups.md)). It publishes no port.
- **`backup-offsite`** is optional (compose profile `offsite`, off by default): it copies the backups to any rclone remote at 03:00 and never deletes there; it is on its own network, without the database.

## Request lifecycle

What happens to a request such as `POST /api/v1/spaces/{spaceId}/expenses` ([spec section 7](../superpowers/specs/2026-10-11-hearth-design.md#7-architecture)):

1. **Caddy** receives the request over HTTPS and proxies it to the `app` container.
2. **The route handler** in `src/app/api/v1/...`, built with `defineRoute` (`src/composition/route.ts`), handles the edges: it authenticates the caller (session cookie or Bearer token, both resolve the same user), validates the query and body against the Zod contract, and carries the request id (`X-Request-Id`).
3. **The use case** in the module's `application/` runs. Authorization is decided here, by the caller's `SpaceMember` and role, never only in the handler.
4. **The domain code** runs: entities, value objects and domain services, in pure TypeScript.
5. **Ports lead to Drizzle adapters.** The use case talks to ports; the container binds them to the `infrastructure/` adapters, and the adapters query PostgreSQL.
6. **A `Result` maps to the response.** A success becomes the JSON response; an error becomes an RFC 9457 `application/problem+json` response with a stable `code` and the request id.

## Web UI

The pages live in `src/app/(web)`, with no locale in the URL ([ADR 0003](../adr/0003-web-ui-talks-to-the-api-through-a-generated-client.md), ruling P117):

- **Reads:** a Server Component container calls `/api/v1` over loopback (`INTERNAL_API_ORIGIN`, default `http://127.0.0.1:$PORT`) with the request's cookie, client address and language.
- **Writes:** client containers call the same-origin `/api/v1` from the browser, then refresh the Server Components. There are no server actions.
- **Session redirect:** `src/proxy.ts` sends a request without a session cookie to `/sign-in?next=<path>`; only same-origin paths are honoured.
- **Language:** next-intl picks `es` or `en` from the stored locale, a visitor cookie or `Accept-Language` (P120).
- **Formats:** only `src/shared/ui/format/` formats numbers, dates and times, from the person's effective preferences (P121).
- **Boundaries:** dependency-cruiser keeps UI code to the generated client and three pure kernel files (P119).
- **Server and client entries:** a module's `ui/index.ts` is imported by client code and a module's server containers are exported from `ui/server.ts` (P153); a boundary rule fails an `index.ts` that reaches the server-only API reader.
- **Speed:** `package.json` declares `sideEffects: ["**/*.css"]` so the bundler can drop what a route does not use from barrel files, and the sheets' Radix Dialog loads when the first sheet opens. [ADR 0004](../adr/0004-web-ui-testing-and-performance-gates.md) has the gates that hold the line.

## Modules

The eight modules live in `src/modules/<module>/` ([spec 5.1](../superpowers/specs/2026-10-11-hearth-design.md#51-bounded-contexts-modules)). A tick means the folder exists today; `balances` and `reporting` are read models and have no tables, so they have no `infrastructure/`. Since M6a the `ui/` layer exists in `identity`, `spaces`, `accounts`, `categories` and `ledger` (containers over presentational components).

| Module | Responsibility | `domain` | `application` | `contracts` | `infrastructure` |
|---|---|---|---|---|---|
| `identity` | Users, authentication, sessions | yes | yes | yes | yes |
| `spaces` | Personal, shared and direct spaces; members (registered or guest), roles, invitations, guest claims | yes | yes | yes | yes |
| `accounts` | Where money lives | yes | yes | yes | yes |
| `categories` | Customizable hierarchical categories per space | yes | yes | yes | yes |
| `ledger` | Expenses, incomes, transfers, settlements (and recurrences) | yes | yes | yes | yes |
| `balances` | Who owes whom inside a shared space (read model) | yes | yes | yes | none |
| `budgeting` | Monthly plans, lines, allocations, rollover | yes | yes | yes | yes |
| `reporting` | Dashboards and the unified personal view (read models) | yes | yes | yes | none |

Besides the modules, `src/shared/` holds the kernel (`Money`, `PeriodPolicy`, `Result`, ids, `Clock`), the HTTP layer (`defineRoute`, problem+json, pagination, idempotency, ETag) and the shared infrastructure (database client, transaction manager, logger). `src/composition/` is the composition root.

## Dependency rules

- **The rule.** `app → application → domain`, and `infrastructure → application / domain`. The domain imports only its own module's domain and the shared kernel.
- **Modules talk only through application ports.** Another module is reached only through `src/modules/<module>/application/index.ts`, its public API. The one exception is table files: a Drizzle `*.schema.ts` may import another module's `*.schema.ts` to declare a foreign key, and nothing else of that module.
- **The composition root wires the adapters.** `src/composition/container.ts` builds the container: it creates the Drizzle adapters and binds them to the ports the use cases declare. Route handlers get their use cases from it.
- **It is enforced.** [ADR 0001](../adr/0001-boundary-enforcement-with-dependency-cruiser.md) chose dependency-cruiser. The rules are in [`.dependency-cruiser.cjs`](https://github.com/Facabore/Hearth/blob/development/.dependency-cruiser.cjs) at the repo root and run in CI as `pnpm lint:boundaries`.

## Cross-cutting conventions

Each is decided in the [design spec](../superpowers/specs/2026-10-11-hearth-design.md); this is where to look.

- **Money** is a `bigint` in minor units and is sent over the wire as a string, with its currency (D6, [key decisions](../superpowers/specs/2026-10-11-hearth-design.md#6-key-decisions)).
- **Computed on read.** Balances, budget figures and reports are derived with queries and never stored (D7, [derived metrics](../superpowers/specs/2026-10-11-hearth-design.md#54-derived-metrics-computed-on-read-never-stored)).
- **Logical deletes and the audit.** Every delete is logical; edits are kept in `transaction_audit` (D8).
- **Stored periods.** A plan's boundaries are stored when it is created, so a policy change never moves history (D10).
- **Idempotency keys.** The `Idempotency-Key` header is accepted on the POSTs that create a transaction or a recurrence; a replay returns the original response ([HTTP API conventions](../superpowers/specs/2026-10-11-hearth-design.md#http-api-conventions)).
- **ETag and If-Match.** Updates of transactions and plans carry the row `version` as an `ETag`, and a mismatch returns `412` (same conventions).
- **Cursor pagination.** `?cursor=&limit=`, default 50, maximum 200 (same conventions).
- **OpenAPI from Zod.** Each module's `contracts/` holds the Zod schemas; the OpenAPI 3.1 document is generated from them with zod-openapi ([ADR 0002](../adr/0002-openapi-generator-zod-openapi.md)), served at `/api/v1/openapi.json`, and its reviewed snapshot is [`openapi/openapi.snapshot.json`](https://github.com/Facabore/Hearth/blob/development/openapi/openapi.snapshot.json).
- **Errors.** RFC 9457 `problem+json` with a stable `code`; the API never returns translated text.
