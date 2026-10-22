# Hearth: review rules

These are the rules the code review (gga) checks staged files against. When a change breaks one, name the rule and the file:line. Do not flag style that Prettier and ESLint already enforce.

## Architecture

- Modules live in `src/modules/<module>/` and split into `domain`, `application`, `infrastructure`, `contracts` and `ui`.
  - Domain code imports nothing from infrastructure, HTTP, Next.js or Drizzle.
  - Application code never imports `src/shared/http`.
  - dependency-cruiser enforces this (ADR 0001).
- A helper that two modules share goes to `src/shared/kernel` (pure) or `src/shared/http` (the HTTP edge). Never duplicate it in both modules.
- The UI talks only to `/api/v1`, through the client generated from `openapi/openapi.snapshot.json` (ADR 0003).
  - The UI imports no module's `domain`, `application`, `infrastructure` or `contracts`, and nothing from `src/composition`.
  - There are no server actions.
  - A module's server containers are exported from `ui/server.ts`. Client-safe code is exported from `ui/index.ts`.
- Zod validates at the HTTP edge only. Domain rules live in the domain, and a writer that skips HTTP still has to pass them.

## Money, dates and data

- Money is `bigint` minor units (`Money`). Never use floats, never use `Number` for amounts, and never do rounding that isn't `Money`'s own.
- Calendar dates are `LocalDate` in the space's or person's time zone. Never derive a date from a UTC instant without `localDateIn` or `todayIn`. Time zones are IANA names.
- Deletes are logical, and every change to money keeps its audit. Never hard-delete stored records.
- A write that changes stored data, or the format it is stored in, needs a migration under `drizzle/` and `pnpm db:check` passing.
- Money writes take the space lock before they read membership (`spaceLocks.lockForMoneyWrite`, issue #89). Never read a balance or a membership before taking that lock.
- Every change to the contract updates the OpenAPI snapshot and the generated `schema.d.ts`. Optional fields only. Changing what existing clients receive is a breaking change and must be called out.

## Security

- Every route goes through `defineRoute`, which handles the session, Zod, the NUL guard and problem responses. Authorize inside the use case: membership, role and `canModify`.
- `next`, `returnTo` and `?from=` are validated the way `safeNext` and `safeReturnTo` validate them. A `?from=` must be one of the person's own space ids.
- Never log secrets, tokens, passwords or full request bodies. Errors in logs go through `failureOf`.
- Never read `.env` files from code paths other than the config loader.

## UI

- Every screen below the bottom navigation has a way back (`ScreenHeader`).
- No horizontal scroll at 390 or 320 px. Targets are at least 44×44 px. Sheets stay above the bar.
- Copy comes from `src/i18n/messages/{es,en}.json`, with both languages. Spanish uses neutral Latin American tú, never voseo. Prefer "pagó por ti" and "tu parte"; never frame a shared bill as a loan.
- Money direction is never shown by color alone. It always carries a sign or a word.
- Route script budgets in `tests/performance/budgets.json` are never raised to fit a change. Lazy-load instead.

## Tests

- Every behavior change comes with a test through the public interface: a use case, HTTP acceptance, or a component in jsdom.
- Concurrency fixes need a deterministic integration test against PostgreSQL, using the `tests/support/locks.ts` barrier.
- Tests never depend on the wall clock or on network services.
