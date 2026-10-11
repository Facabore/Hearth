# E0 — Foundations

**Goal:** a deployable walking skeleton with the architecture, shared kernel, persistence, quality gates and the versioned HTTP API foundation in place, so every later story starts from a green, enforced baseline.

**Modules involved:** `shared/kernel`, `shared/http`, `shared/infrastructure`, `composition`, `app/api/v1`, CI and deployment tooling.

**Delivery (spec D18):** backend first. E0 delivers the API foundation (contracts, OpenAPI, problem+json, auth guard, idempotency, pagination, concurrency) that every later endpoint reuses. Web UI setup, including internationalization, lives in [E9-web-ui.md](E9-web-ui.md).

---

## HU-E0-01 — Bootstrap the repository with pinned stable versions

- **Milestone:** M0 · **Priority:** Must · **Size:** S · **Depends on:** — · **Module(s):** repository root

**User story:** As a developer, I want the repository bootstrapped with the latest stable versions pinned exactly, so that every machine and CI run resolves the same dependency graph.

```gherkin
Feature: Repository bootstrap with pinned versions

  Scenario: Fresh clone installs reproducibly
    Given a fresh clone of the repository
    And the Node.js version declared in ".nvmrc" is active
    When the developer runs "pnpm install --frozen-lockfile"
    Then the install succeeds without modifying "pnpm-lock.yaml"
    And "package.json" declares the pnpm version in the "packageManager" field

  Scenario: Dependency ranges are rejected
    Given "package.json" declares the dependency "zod" with the range "^3.0.0"
    When the developer runs "pnpm check:pinned"
    Then the command exits with a non-zero status
    And the output names "zod" as not pinned to an exact version

  Scenario: Bootstrap versions are recorded
    Given the repository has just been bootstrapped
    When the developer opens "docs/stack-versions.md"
    Then it lists the exact versions of Next.js, React, TypeScript, Drizzle ORM, drizzle-kit, Better Auth, Zod, the OpenAPI generator, next-intl, Vitest, Testcontainers, Playwright, Tailwind CSS, Node.js and PostgreSQL
    And each version is the latest stable release on the bootstrap date
```

**Technical notes:**
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- `check:pinned` is a small script that fails on `^`, `~`, `*`, `latest` or tag ranges in `dependencies` and `devDependencies`.
- Next.js App Router initialized with `src/app/api/v1/`; no business code.
- Tailwind CSS, shadcn/ui, next-intl and Playwright are pinned now but first used by the web UI stories of epic E9 (spec D18).

---

## HU-E0-02 — Hexagonal module skeleton with boundary lint

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-01 · **Module(s):** all (skeleton), `composition`

**User story:** As a developer, I want the module-first hexagonal structure enforced by lint, so that the domain never depends on frameworks or I/O and modules stay decoupled.

```gherkin
Feature: Architectural boundaries are enforced

  Scenario: Domain importing an ORM fails the boundary lint
    Given the file "src/modules/ledger/domain/transaction.ts" imports "drizzle-orm"
    When the developer runs "pnpm lint:boundaries"
    Then the command exits with a non-zero status
    And the violation names the rule "domain-must-be-pure"

  Scenario: Domain importing Next.js fails the boundary lint
    Given the file "src/modules/budgeting/domain/allocation.ts" imports "next/headers"
    When the developer runs "pnpm lint:boundaries"
    Then the command exits with a non-zero status

  Scenario: Cross-module access to internals fails the boundary lint
    Given the file "src/modules/balances/application/compute-balances.ts" imports "src/modules/ledger/infrastructure/transaction-repository.ts"
    When the developer runs "pnpm lint:boundaries"
    Then the command exits with a non-zero status
    And the violation states that modules may only import another module's public application API

  Scenario: Allowed dependency directions pass
    Given "src/app" imports a use case from "src/modules/ledger/application"
    And "src/modules/ledger/infrastructure" imports "src/modules/ledger/domain"
    When the developer runs "pnpm lint:boundaries"
    Then the command exits with status 0
```

**Technical notes:**
- Folders per module: `domain/`, `application/`, `contracts/`, `infrastructure/`, `ui/`; plus `shared/kernel`, `shared/http`, `shared/infrastructure`, `composition/` (spec section 7).
- Rules: `app → application → domain`; `infrastructure → application/domain`; domain imports only `shared/kernel`.
- Tool: dependency-cruiser or eslint-plugin-boundaries (choose one at implementation, record in an ADR).
- Composition root wires ports to adapters per request.

---

## HU-E0-03 — Money value object

- **Milestone:** M0 · **Priority:** Must · **Size:** S · **Depends on:** HU-E0-02 · **Module(s):** `shared/kernel`

**User story:** As a developer, I want a Money value object based on integer minor units, so that amounts never suffer floating-point errors.

```gherkin
Feature: Money in integer minor units

  Scenario: Money is stored as bigint minor units
    When Money is created from the major amount 1,600,000 COP
    Then its minor-unit value is 160000000n
    And its currency is "COP"

  Scenario: Adding money of different currencies fails
    Given Money of 100,000 COP and Money of 50 USD
    When they are added
    Then the result is the error "CurrencyMismatch"

  Scenario: Allocating by ratio preserves the total
    Given Money of 1,470,000 COP
    When it is allocated by the ratio 40:60
    Then the parts are 588,000 COP and 882,000 COP

  Scenario: Allocating with a remainder uses the currency rounding unit
    Given Money of 100,000 COP and the COP rounding unit of 1 peso
    When it is allocated equally into 3 parts
    Then one part is 33,334 COP and two parts are 33,333 COP
    And the parts sum to exactly 100,000 COP
    And allocating the same input again yields the same parts in the same order

  Scenario: Fractional minor units are rejected
    When Money is created from the major amount 10.005 COP
    Then the result is the error "InvalidMoneyPrecision"
```

**Technical notes:**
- Currency exponent from ISO 4217 (COP = 2); allocation works in the currency's rounding unit (COP: 1 peso = 100 minor units), so COP parts never carry cents (spec 5.3).
- `allocate(ratios)` uses the largest-remainder method with deterministic tie-breaking by input order.
- Immutable; operations return new instances; comparison helpers (`isZero`, `isNegative`, `compare`).

---

## HU-E0-04 — PeriodPolicy, Result, Id and Clock kernel types

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-02 · **Module(s):** `shared/kernel`

**User story:** As a developer, I want PeriodPolicy, Result, Id and Clock primitives in the shared kernel, so that every module derives periods, reports errors and reads time the same way.

```gherkin
Feature: Kernel primitives for periods, results and time

  Scenario Outline: A monthly policy assigns a date to its period and label
    Given a space with the period policy MONTHLY(<day>)
    When the period is derived for the date <date>
    Then the period runs from <periodStart> to <periodEnd>
    And its label is "<label>"

    Examples:
      | day | date       | periodStart | periodEnd  | label   |
      | 1   | 2026-10-31 | 2026-10-01  | 2026-10-31 | 2026-10 |
      | 1   | 2026-11-01 | 2026-11-01  | 2026-11-30 | 2026-11 |
      | 15  | 2026-11-20 | 2026-11-15  | 2026-12-14 | 2026-11 |
      | 25  | 2026-10-24 | 2026-09-25  | 2026-10-24 | 2026-10 |
      | 25  | 2026-10-25 | 2026-10-25  | 2026-11-24 | 2026-11 |

  Scenario Outline: Anchor days beyond the end of a short month are clamped
    Given a space with the period policy MONTHLY(31)
    When the period is derived for the date <date>
    Then the period runs from <periodStart> to <periodEnd>

    Examples:
      | date       | periodStart | periodEnd  |
      | 2027-02-27 | 2027-01-31  | 2027-02-27 |
      | 2027-02-28 | 2027-02-28  | 2027-03-30 |
      | 2028-02-29 | 2028-02-29  | 2028-03-30 |

  Scenario Outline: A semi-monthly policy assigns a date to its half-month period
    Given a space with the period policy SEMI_MONTHLY(<day1>, <day2>)
    When the period is derived for the date <date>
    Then the period runs from <periodStart> to <periodEnd>
    And its label is "<label>"

    Examples:
      | day1 | day2 | date       | periodStart | periodEnd  | label      |
      | 1    | 16   | 2026-11-10 | 2026-11-01  | 2026-11-15 | 2026-11 H1 |
      | 1    | 16   | 2026-11-20 | 2026-11-16  | 2026-11-30 | 2026-11 H2 |
      | 5    | 20   | 2026-11-03 | 2026-10-20  | 2026-11-04 | 2026-10 H2 |

  Scenario Outline: Invalid period policies are rejected
    When the period policy <policy> is created
    Then the result is the error "InvalidPeriodPolicy"

    Examples:
      | policy               |
      | MONTHLY(0)           |
      | MONTHLY(32)          |
      | SEMI_MONTHLY(16, 16) |
      | SEMI_MONTHLY(20, 5)  |

  Scenario: Today is computed in the space timezone
    Given the Clock reads the instant 2026-11-01T04:30:00Z
    And the timezone is "America/Bogota"
    When today's date is requested
    Then the date is 2026-10-31

  Scenario: Result carries typed domain errors without throwing
    Given a use case that fails with the domain error "NotASpaceMember"
    When the use case is executed
    Then it returns a failed Result whose error code is "NotASpaceMember"
    And no exception propagates to the caller
```

**Technical notes:**
- `PeriodPolicy` is an immutable discriminated union (`MONTHLY(day)` with day 1–31, `SEMI_MONTHLY(day1, day2)` with 1 ≤ day1 < day2 ≤ 31), default `MONTHLY(1)`; `periodFor(date)` returns a `Period` (startDate, endDate, label). The union stays open to `WEEKLY` and `BIWEEKLY` (HU-E8-09, Won't-v1) (spec 5.2, D14).
- Clamping: an anchor day beyond the month length starts the period on the month's last day (day 31 → 2027-02-28, 2028-02-29, 2026-04-30).
- Period label (spec 5.3): `MONTHLY` → the month containing most of the period's days (start month if the anchor day ≤ 15, else the following month: 2026-09-25 to 2026-10-24 is "2026-10"); `SEMI_MONTHLY` → the start date's month plus "H1" (starts on day1) or "H2" (starts on day2). The API also exposes start and end dates.
- `Result<T, E extends DomainError>` with `ok`, `err`, `map`, `flatMap`; `Id` is a branded string type (UUIDv7 generator behind a port).
- `Clock` is a port with a system adapter and a fixed test adapter.

---

## HU-E0-05 — PostgreSQL access with Drizzle, migrations and Testcontainers

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-02 · **Module(s):** `shared/infrastructure`

**User story:** As a developer, I want Drizzle ORM with versioned migrations and real-PostgreSQL integration tests, so that persistence behaviour is verified against the production engine.

```gherkin
Feature: Database access and migrations

  Scenario: Migrations apply to an empty database
    Given an empty PostgreSQL container started by Testcontainers
    When the migration runner applies all migrations
    Then every migration is recorded as applied
    And running the migration runner again applies nothing

  Scenario: Schema drift is detected
    Given a Drizzle schema change without a generated migration
    When the developer runs "pnpm db:check"
    Then the command exits with a non-zero status
    And the output states that a migration is missing

  Scenario: Repository integration test runs against real PostgreSQL
    Given a PostgreSQL container with all migrations applied
    When the sample repository saves and reloads a record with amount 160000000 minor units
    Then the reloaded amount is exactly 160000000 as a bigint

  Scenario: Use cases run inside a single database transaction
    Given a use case that writes two rows and then fails
    When the transaction manager executes it
    Then neither row is persisted
```

**Technical notes:**
- Money columns are `bigint` mapped to TypeScript `bigint`, never `number`.
- `TransactionManager` port in `shared/infrastructure`; repositories receive the transaction context.
- PostgreSQL image version pinned to match production (HU-E0-07).

---

## HU-E0-06 — Continuous integration pipeline

- **Milestone:** M0 · **Priority:** Must · **Size:** S · **Depends on:** HU-E0-02, HU-E0-05, HU-E0-09 · **Module(s):** CI

**User story:** As a developer, I want GitHub Actions to run every quality gate on each pull request, so that nothing merges unless it is green.

```gherkin
Feature: CI quality gates

  Scenario: Pull request runs all gates
    Given a pull request against "main"
    When the CI workflow runs
    Then the jobs "lint", "boundaries", "typecheck", "test" and "build-image" are executed
    And the "test" job runs unit, Testcontainers integration and HTTP API acceptance tests

  Scenario: A type error blocks the merge
    Given a pull request that introduces a TypeScript type error
    When the CI workflow runs
    Then the "typecheck" job fails
    And the pull request cannot be merged

  Scenario: An unintended API contract change blocks the merge
    Given a pull request that changes the Zod contract of "GET /api/v1/me" without updating the OpenAPI snapshot
    When the CI workflow runs
    Then the "test" job fails naming the changed operation "GET /api/v1/me"

  Scenario: Main branch produces a tagged image
    Given a commit merged to "main"
    When the CI workflow runs
    Then a Docker image tagged with the commit SHA is built
```

**Technical notes:**
- Uses pnpm store caching; Node.js version read from `.nvmrc`.
- Docker layer cache; image build uses a multi-stage Dockerfile with Next.js standalone output.
- `@critical` scenarios run over HTTP against the built app with PostgreSQL in Testcontainers (spec section 9); the OpenAPI snapshot test comes from HU-E0-09.
- Branch protection requires all jobs. The i18n catalog check joins the "lint" job with HU-E9-02.

---

## HU-E0-07 — Deploy to the VPS with Docker Compose and Caddy

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-06, HU-E0-09 · **Module(s):** deployment

**User story:** As the owner, I want the application deployed to my VPS with Docker Compose and automatic TLS, so that my household and API clients can reach it over HTTPS.

```gherkin
Feature: Self-hosted deployment

  Scenario: Stack starts with TLS and exposes the API
    Given a VPS with Docker installed and DNS for "hearth.example.com" pointing to it
    And a ".env" file with the required variables
    When the owner runs "docker compose up -d"
    Then the services "app", "db" and "caddy" are running
    And "GET https://hearth.example.com/api/v1/health" returns status 200 with a valid certificate
    And "GET https://hearth.example.com/api/v1/openapi.json" returns the OpenAPI 3.1 document

  Scenario: Plain HTTP redirects to HTTPS
    When a client requests "http://hearth.example.com"
    Then the response redirects to "https://hearth.example.com"

  Scenario: Database is not exposed publicly
    When a client from outside the VPS connects to port 5432
    Then the connection is refused

  Scenario: Migrations run before the app accepts traffic
    Given a new release with one pending migration
    When the stack is updated
    Then the migration is applied before the app container reports healthy

  Scenario: Missing required secret prevents start-up
    Given ".env" does not define "BETTER_AUTH_SECRET"
    When the app container starts
    Then it exits with an error naming "BETTER_AUTH_SECRET"
```

**Technical notes:**
- Environment validated with Zod at start-up.
- `.env.example` committed; `.env` git-ignored.
- `GET /api/v1/health` is a liveness check in M0 (HU-E8-02 adds the database check); a minimal sign-in page is acceptable but not required, because the web UI ships in E9.
- Deployment runbook in `docs/operations/deploy.md`.

---

## HU-E0-08 — Internationalization setup (moved)

Moved on 2026-10-11 to epic E9 as HU-E9-02 in [E9-web-ui.md](E9-web-ui.md): under backend-first delivery (spec D18) internationalization is a web UI concern, and the API returns stable error codes, never translated text. This ID is retired and never reused.

---

## HU-E0-09 — API foundation: contracts, OpenAPI, problem+json and auth guard

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-02, HU-E0-03, HU-E0-04 · **Module(s):** `shared/http`, `app/api/v1`, `composition`

**User story:** As an API client developer, I want every endpoint to follow one contract-first convention for schemas, errors, authentication and money, so that any client (web, mobile, scripts) can rely on the same predictable HTTP API.

```gherkin
Feature: HTTP API foundation

  Scenario: The OpenAPI document is generated from module contracts
    When a client requests "GET /api/v1/openapi.json" without credentials
    Then the response status is 200
    And the document declares OpenAPI version "3.1.0"
    And it contains the operations "GET /api/v1/health" and "GET /api/v1/me" with their Zod-derived response schemas
    And it contains the shared component schemas "Money" and "Problem"

  Scenario Outline: Domain errors are returned as problem+json with a stable code
    Given a use case behind an endpoint returns the domain error "<code>"
    When a client calls that endpoint with the header "Accept-Language: es"
    Then the response status is <status> with content type "application/problem+json"
    And the body has the code "<code>" and a requestId equal to the "X-Request-Id" response header
    And the body contains no text translated to Spanish

    Examples:
      | code               | status |
      | InsufficientRole   | 403    |
      | InvalidAmount      | 422    |
      | SpaceNotFound      | 404    |
      | OutstandingBalance | 409    |
      | PeriodClosed       | 409    |

  Scenario: Unauthenticated requests are rejected
    When a client requests "GET /api/v1/me" without a session cookie or Bearer token
    Then the response status is 401 with the code "Unauthenticated"
    And "GET /api/v1/health" still returns status 200 without credentials

  Scenario: Session cookie and Bearer token resolve the same user
    Given "Ana" holds a web session cookie and a Bearer token issued for her account
    When a client requests "GET /api/v1/me" once with the cookie and once with the Bearer token
    Then both responses have status 200 and return the same user id for "Ana"

  Scenario: Money is serialized as a minor-units string
    Given an endpoint whose contract returns Money of 1,600,000 COP
    When a client calls it
    Then the money field is serialized as {"amount": "160000000", "currency": "COP"}
    And a request that sends {"amount": 160000000, "currency": "COP"} with a JSON number is rejected with status 422, the code "ValidationFailed" and an error for the path "amount"
```

**Technical notes:**
- Route handlers in `src/app/api/v1/` only parse with the module contract, call the use case and map its `Result` to HTTP; authorization stays in use cases (spec 7). The guard resolves the acting user from the session cookie or `Authorization: Bearer` through a `SessionResolver` port: a test adapter until HU-E1-01 supplies the Better Auth adapter, after which the cookie/Bearer scenario runs against Better Auth.
- One `DomainError → problem+json` mapper in `shared/http` (spec section 8): validation 422 (`ValidationFailed` with `errors[]` for contract failures), not found 404, `InsufficientRole` 403, conflicts and invariant violations 409, `PeriodClosed` 409, precondition failed 412, unauthenticated 401; unexpected errors are logged and returned as 500 `InternalError`. Body: `type`, `title` (fixed English summary), `status`, `code`, `requestId`, optional `errors[]`.
- OpenAPI 3.1 is generated from every module's `contracts/` Zod schemas (generator chosen at bootstrap and recorded in an ADR); a snapshot test of the document fails on unintended contract changes (spec section 9).
- `X-Request-Id` is accepted from the client or generated, echoed on every response and propagated to logs.
- Shared `MoneySchema`: `amount` is a string matching `^-?\d+$` in minor units, `currency` an ISO 4217 code (spec section 7).

---

## HU-E0-10 — Idempotency, pagination and optimistic concurrency

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-05, HU-E0-09 · **Module(s):** `shared/http`, `shared/infrastructure`

**User story:** As an API client developer, I want safe retries on money-creating requests, bounded cursor pagination and conflict detection on updates, so that flaky networks never duplicate money and concurrent edits never overwrite each other silently.

```gherkin
Feature: Idempotency, pagination and optimistic concurrency

  Background:
    Given "Ana" is authenticated
    And a money-creating POST endpoint wrapped with the idempotency middleware

  Scenario: A replayed request returns the original response
    Given "Ana" sent a POST creating a record of 85,000 COP with the header "Idempotency-Key: 7f3c9a1e" and received status 201 with record id "rec-1"
    When "Ana" sends the same request with the same "Idempotency-Key" again
    Then the response status is 201 with the same body and record id "rec-1"
    And exactly one record of 85,000 COP exists

  Scenario: Reusing a key with a different payload is rejected
    Given "Ana" already used the "Idempotency-Key" "7f3c9a1e" for a record of 85,000 COP
    When "Ana" sends a POST with the same key for a record of 95,000 COP
    Then the response status is 409 with the code "IdempotencyKeyConflict"
    And no record of 95,000 COP is created

  Scenario Outline: Cursor pagination enforces its limits
    Given 250 records exist
    When "Ana" lists them with <query>
    Then the response status is <status>
    And the page contains <items> items

    Examples:
      | query       | status | items |
      | no limit    | 200    | 50    |
      | limit=200   | 200    | 200   |
      | limit=201   | 422    | 0     |

  Scenario: Following the cursor visits every record once
    Given 120 records exist
    When "Ana" follows "nextCursor" from the first page until it is null
    Then the pages contain 50, 50 and 20 records
    And no record appears twice

  Scenario: Update with a matching If-Match succeeds
    Given a transaction returned with the header "ETag: \"3\""
    When "Ana" updates it with the header "If-Match: \"3\""
    Then the response status is 200 with the header "ETag: \"4\""

  Scenario: Update with a stale If-Match is rejected
    Given a transaction whose current ETag is "\"4\""
    When "Ana" updates it with the header "If-Match: \"3\""
    Then the response status is 412 with the code "PreconditionFailed"
    And the transaction is unchanged
```

**Technical notes:**
- Placed in M0, not M1: the first money endpoints in M1 need all three on day one (`POST` expenses in HU-E4-01, the paginated list in HU-E4-05, `If-Match` edits in HU-E4-06), and spec section 7 places them in `shared/http`. They are built once here, verified against a test-only route in the acceptance harness, and reused by the ledger and budgeting stories.
- Idempotency (spec 7): the optional `Idempotency-Key` header is honoured on every POST that creates money records (expenses, transfers including fund contributions, settlements); the key, a request hash and the response snapshot are stored per (user, route, key) for 24 hours, in the same database transaction as the use case.
- Pagination: `?cursor=&limit=`, default 50, max 200, responses `{ "items": [...], "nextCursor": "..." | null }`; the cursor is opaque and encodes the sort key plus id; `limit` above 200 fails with `ValidationFailed`.
- Concurrency: transactions and budget plans carry an integer `version` exposed as a strong `ETag`; `If-Match` mismatch returns 412 `PreconditionFailed` (spec section 8).
