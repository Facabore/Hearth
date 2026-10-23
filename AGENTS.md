# Hearth review rules

These are the rules every change to Hearth must follow. Gentleman Guardian Angel (`gga`) reviews staged code against this file before each commit, and coding agents read it before they write. Each rule points to where it was decided; the full record is in [docs/decisions/README.md](docs/decisions/README.md).

Fail a review only for a rule below. Do not fail it for style that Prettier or ESLint already enforce.

## Architecture

- **Hexagonal modules.** Code lives in `src/modules/<module>/` with the layers `domain`, `application`, `contracts`, `infrastructure` and `ui`. Dependencies point inward: `app → application → domain` and `infrastructure → application / domain` ([architecture](docs/architecture/README.md#dependency-rules), ADR 0001).
- **Pure domain.** `domain/` imports only its own module's domain and `src/shared/kernel`. No Next.js, Drizzle, `fetch`, `Date.now()` or other I/O in the domain; time comes from the `Clock` port.
- **Modules meet through their public API.** Another module is reached only through `src/modules/<module>/application/index.ts`. The one exception: a Drizzle `*.schema.ts` may import another module's `*.schema.ts` to declare a foreign key.
- **Ports in application, adapters in infrastructure.** A use case depends on ports it declares. Only `src/composition/container.ts` creates adapters and binds them.
- **Authorization lives in the use case.** A use case checks the caller's `SpaceMember` and role; a route handler never decides authorization alone.
- **`src/shared` never imports a module.**
- **No circular dependencies.** `pnpm lint:boundaries` enforces these rules; a change must not weaken `.dependency-cruiser.cjs` to pass.

## Errors and results

- **Expected failures are `Result` values.** Domain and application code return `err(domainError("Code"))` from `src/shared/kernel/result.ts`, never throw, for anything a caller can cause.
- **Throwing is for broken invariants only**, such as a `RangeError` for a value a validated caller can never send.
- **Error codes are stable PascalCase names.** The API answers RFC 9457 `application/problem+json` with the `code`; it never sends translated text.

## Money, time and data

- **Money is a `bigint` in minor units with its currency**, and it travels over the wire as a string (D6). Never use `number` or floating point for money.
- **Figures are computed on read** (D7). Balances, budget figures and reports are never stored.
- **Deletes are logical** (D8), and edited transaction parts go to the audit.
- **A transaction keeps its local date, a UTC instant and the recorder's IANA zone** (D19, P40–P44).
- **Plan boundaries are stored** (D10); a period-policy change never moves history.
- **Updates honour `If-Match`** where the resource has an `ETag`, and answer `412` on a stale version.
- **Creating POSTs accept `Idempotency-Key`** where the spec says so; a replay answers the original response.

## HTTP API

- **Route handlers are built with `defineRoute`** (`src/composition/route.ts`), which authenticates, validates against the Zod contract and carries `X-Request-Id`.
- **Contracts are Zod schemas in the module's `contracts/`.** The OpenAPI document is generated from them (ADR 0002). A contract change updates `openapi/openapi.snapshot.json` and `src/shared/ui/api/schema.d.ts` in the same change (P139).
- **Lists use cursor pagination**: `?cursor=&limit=`, default 50, maximum 200.

## Web UI

- **The UI talks only to `/api/v1`, through the generated client** (ADR 0003, P117). No server actions, and no imports of a module's `domain`, `application`, `infrastructure` or `contracts` from UI code (P118, P119).
- **Container and presentational components** (P127). A server container is a pure `load*` function over the `Api` plus an async component; presentational components take DTOs and serializable formats and fetch nothing.
- **Client code imports a module's `ui/index.ts`; server containers come from `ui/server.ts`** (P153). An `index.ts` must never reach the server-only API reader.
- **Every user-facing string comes from the message catalogs** in `src/i18n/messages/` (`es.json` and `en.json`, typed keys). No hard-coded copy in components, and every API error `code` maps to a key.
- **Spanish copy uses neutral Spanish with "tú"**, never voseo. Regional words belong to the variants of D24, not the base `es.json`.
- **Formats never come from the language** (D23). Only `src/shared/ui/format/` formats numbers, dates and times, from the person's effective preferences (P121); no other `Intl` or `toLocale*` call.
- **Amounts never break across lines**: a no-break space between the symbol and the digits, and a word joiner (U+2060) after a minus sign.
- **Accessibility.** Every control has an accessible name, a visible keyboard focus and a touch target of at least 44 px ([design rubric R4](docs/design/batch2-ux-critique.md#rubric)); screens pass axe in light and dark.
- **Speed.** Do not add a dependency or a client component that pushes a route over its script budget in `tests/performance/budgets.json` (ADR 0004, P134). A raised budget is the owner's decision, never a silent change.

## Tests

- **Behavior first, through the public interface.** Use cases are tested through their exported factory, components through Testing Library queries by role and name.
- **One test per rule the change adds, asserting every observable effect** (result, error code, persisted data, rendered text).
- **Integration tests use Testcontainers PostgreSQL** (`*.int.test.ts`), never a mocked database.
- **No test reads the real clock**; use the `Clock` port or the fixed `serverNow()`.

## TypeScript

- **`strict`, `noUncheckedIndexedAccess` and `noImplicitOverride` stay on.** No `any`, no `@ts-ignore`, and no non-null `!` to silence a possibly undefined value without a reason in a comment.
- **Prefer `readonly`** for domain types and DTOs.
- **Names in English** for code, identifiers, comments and docs.

## Commits and docs

- **Conventional Commits** (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`) with the story or issue reference, for example `(Refs #73)`. No AI attribution lines.
- **Each decision lands in `docs/`** in the same change: a design decision in the spec's section 6 and the decisions index, a technology choice as an ADR, an execution ruling in its plan's Self-Review.
- **A story that changes the API, the model or a screen updates its spec section, backlog story or design doc** in the same pull request.
