# E0 — Foundations

**Goal:** a deployable walking skeleton with the architecture, shared kernel, persistence, quality gates and i18n in place, so every later story starts from a green, enforced baseline.

**Modules involved:** `shared/kernel`, `shared/infrastructure`, `composition`, `app` (shell only), CI and deployment tooling.

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
    Then it lists the exact versions of Next.js, React, TypeScript, Drizzle ORM, drizzle-kit, Better Auth, Zod, next-intl, Vitest, Playwright, Tailwind CSS, Node.js and PostgreSQL
    And each version is the latest stable release on the bootstrap date
```

**Technical notes:**
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- `check:pinned` is a small script that fails on `^`, `~`, `*`, `latest` or tag ranges in `dependencies` and `devDependencies`.
- Next.js App Router, Tailwind CSS and shadcn/ui initialized; no business code.

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
- Folders per module: `domain/`, `application/`, `infrastructure/`, `ui/`; plus `shared/kernel`, `shared/infrastructure`, `composition/`.
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

- **Milestone:** M0 · **Priority:** Must · **Size:** S · **Depends on:** HU-E0-02, HU-E0-05 · **Module(s):** CI

**User story:** As a developer, I want GitHub Actions to run every quality gate on each pull request, so that nothing merges unless it is green.

```gherkin
Feature: CI quality gates

  Scenario: Pull request runs all gates
    Given a pull request against "main"
    When the CI workflow runs
    Then the jobs "lint", "boundaries", "typecheck", "test" and "build-image" are executed
    And the "test" job runs unit and Testcontainers integration tests

  Scenario: A type error blocks the merge
    Given a pull request that introduces a TypeScript type error
    When the CI workflow runs
    Then the "typecheck" job fails
    And the pull request cannot be merged

  Scenario: Missing i18n key blocks the merge
    Given a pull request that adds the key "ledger.expense.title" to "es" messages only
    When the CI workflow runs
    Then the "lint" job fails naming the key missing in "en"

  Scenario: Main branch produces a tagged image
    Given a commit merged to "main"
    When the CI workflow runs
    Then a Docker image tagged with the commit SHA is built
```

**Technical notes:**
- Uses pnpm store caching; Node.js version read from `.nvmrc`.
- Docker layer cache; image build uses a multi-stage Dockerfile with Next.js standalone output.
- Branch protection requires all jobs.

---

## HU-E0-07 — Deploy to the VPS with Docker Compose and Caddy

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-06 · **Module(s):** deployment

**User story:** As the owner, I want the application deployed to my VPS with Docker Compose and automatic TLS, so that my household can use it over HTTPS.

```gherkin
Feature: Self-hosted deployment

  Scenario: Stack starts with TLS
    Given a VPS with Docker installed and DNS for "hearth.example.com" pointing to it
    And a ".env" file with the required variables
    When the owner runs "docker compose up -d"
    Then the services "app", "db" and "caddy" are running
    And "https://hearth.example.com" serves the sign-in page with a valid certificate

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
- Deployment runbook in `docs/operations/deploy.md`.

---

## HU-E0-08 — Internationalization setup (es, en)

- **Milestone:** M0 · **Priority:** Must · **Size:** S · **Depends on:** HU-E0-01 · **Module(s):** `app`, `shared/infrastructure`

**User story:** As a user, I want the interface in Spanish by default and available in English, so that I can use the app in my language.

```gherkin
Feature: Localized interface

  Scenario: Spanish is the default locale
    Given a visitor whose browser sends no supported language preference
    When the visitor opens the sign-in page
    Then the page is rendered in Spanish

  Scenario: Signed-in user preference wins
    Given a signed-in user whose locale is "en"
    When the user opens the dashboard
    Then the page is rendered in English

  Scenario Outline: Amounts and dates are formatted per locale
    Given a user whose locale is "<locale>"
    When the amount 1,600,000 COP and the date 2026-10-05 are displayed
    Then the amount reads "<amount>"
    And the date reads "<date>"

    Examples:
      | locale | amount        | date       |
      | es     | $ 1.600.000   | 5/10/2026  |
      | en     | COP 1,600,000 | 10/5/2026  |

  Scenario: Every key exists in both catalogs
    When the developer runs "pnpm i18n:check"
    Then every key in "messages/es.json" exists in "messages/en.json" and vice versa
```

**Technical notes:**
- next-intl with `es` (default, es-CO formats) and `en`.
- COP displayed with zero fraction digits when the fraction is zero; whitespace normalized in tests (Intl may emit non-breaking spaces).
- Dates rendered in `America/Bogota` unless the user timezone differs.
