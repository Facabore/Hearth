# M0 Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Hearth's deployable walking skeleton: a containerized Next.js BFF with the hexagonal skeleton, shared kernel, PostgreSQL persistence, the `/api/v1` foundation, email/password authentication with an automatic personal space, CI and a Docker Compose deployment.

**Architecture:** Modular monolith with hexagonal modules (`src/modules/<module>/{domain,application,contracts,infrastructure}`), a pure shared kernel, a shared HTTP layer, and a composition root. Next.js App Router route handlers under `src/app/api/v1` are thin driving adapters: parse with a Zod contract, call a use case, map its `Result` to HTTP. Boundaries are enforced by dependency-cruiser in CI.

**Tech Stack:** Node.js 24.21.0 LTS, pnpm 12.11.2, Next.js 16.4.0, React 19.3.0, TypeScript 6.0.3, Zod 4.6.5, zod-openapi 6.0.2, Drizzle ORM 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, Better Auth 1.7.7, Vitest 5.0.3, Testcontainers 12.2.0, dependency-cruiser 18.6.0, ESLint 9.39.5, Prettier 3.9.10, PostgreSQL 18.6, Caddy 2.11.7, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (approved 2026-10-11). Stories: `docs/backlog/E0-foundations.md` (HU-E0-01 … 07, 09, 10) and `docs/backlog/E1-identity-and-spaces.md` (HU-E1-01, HU-E1-02). GitHub Project: https://github.com/users/Facabore/projects/4.

## Global Constraints

- Node.js `24.21.0` (`.nvmrc`, Docker `node:24.21.0-alpine`); pnpm `12.11.2` via `packageManager`.
- Every dependency pinned to an exact version (`pnpm add -E`); `pnpm check:pinned` must pass.
- TypeScript `6.0.3` (not 7.x: typescript-eslint 8.71.1 supports `<6.1.0`); ESLint `9.39.5` (not 10.x: eslint-config-next 16.4 plugin peers stop at 9); Drizzle `0.45.4` (1.0 is still RC); Zod `4.6.5`.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- Domain and kernel code import nothing but their own module's domain and `src/shared/kernel` (no Next.js, Drizzle, pg, Better Auth, Zod, Node built-ins).
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL; over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`.
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` and `requestId`; the API never returns translated text.
- Default currency `COP`, default timezone `America/Bogota`, default period policy `MONTHLY(1)`.
- Code, identifiers, comments and docs in English.
- Everything runs in containers: `compose.dev.yaml` for development, Testcontainers for integration tests, `compose.yaml` for production. A host Node.js install is optional.
- PostgreSQL image `postgres:18.6-alpine` everywhere; its volume mounts at `/var/lib/postgresql` (not `/var/lib/postgresql/data`).
- Strict TDD: every behaviour starts with a failing test that is run and seen failing.
- Conventional commits; no AI attribution or `Co-Authored-By` lines.

## Review Focus

1. **Two requests with the same `Idempotency-Key` arriving at the same time** must create exactly one record and both must get the same response — pinned in Task 9 (concurrent replay test).
2. **Money amounts outside PostgreSQL `bigint` range, or with `+`, spaces or decimals** must be rejected with `422 ValidationFailed`, never a 500 — pinned in Task 8 (`MoneySchema` tests).
3. **Malformed JSON bodies** (truncated JSON, wrong content) must return `422 ValidationFailed`, never a 500 — pinned in Task 7 (`defineRoute` tests).
4. **Signing in with different letter case or surrounding spaces in the email** (`" Ana@Example.com "`) must work for an account created as `ana@example.com` — pinned in Task 10 (auth acceptance tests).
5. **A tampered or garbage pagination cursor** must return `422 InvalidCursor`, never a 500 — pinned in Task 9 (pagination tests).

## Execution Workflow

- Work on one branch: `feat/m0-walking-skeleton` from `main`.
- When a task starts, move its GitHub issue to **In Progress** on Project #4; commits reference it (`Refs #N`).
- When all tasks are done, open one pull request that closes #1–#11 (`Closes #1` … `Closes #11`); the cards move to **In Review**, and to **Done** when the owner merges.
- Task-to-issue map: Task 1 → #1 (completed in Task 6), Task 2 → #2, Tasks 3 and 5 → #4, Task 4 → #3, Task 6 → #5 and #1, Tasks 7–8 → #8, Task 9 → #9, Task 10 → #10, Task 11 → #11, Task 12 → #7 (images and stack), Task 13 → #6 (CI) and the VPS deployment of #7.

## File Structure

```
.
├── .dependency-cruiser.cjs          # architecture rules (Task 2)
├── .github/workflows/ci.yml         # CI gates + image build/smoke (Task 13)
├── Caddyfile                        # TLS reverse proxy (Task 12)
├── compose.dev.yaml                 # containerized dev stack (Task 6)
├── compose.yaml                     # production stack (Task 12)
├── compose.local.yaml               # local production smoke override (Task 12)
├── Dockerfile                       # deps/builder/migrator/runner stages (Task 12)
├── drizzle.config.ts                # drizzle-kit config (Task 6)
├── drizzle/                         # generated SQL migrations + meta (Tasks 6, 10, 11)
├── openapi/openapi.snapshot.json    # committed contract snapshot (Task 8)
├── scripts/
│   ├── check-pinned.mjs             # exact-version gate (Task 1)
│   ├── db-check.mjs                 # schema drift gate (Task 6)
│   └── migrate.mjs                  # migration runner for tests and containers (Task 6)
├── docs/
│   ├── adr/0001-…, 0002-…           # boundary tool, OpenAPI generator (Tasks 2, 8)
│   ├── operations/deploy.md         # runbook (Task 12)
│   └── stack-versions.md            # pinned versions (Task 1)
├── src/
│   ├── instrumentation.ts           # env validation at server start (Task 12)
│   ├── app/api/v1/
│   │   ├── health/route.ts          # liveness (Tasks 1, 8)
│   │   ├── openapi.json/route.ts    # OpenAPI document (Task 8)
│   │   ├── me/route.ts              # current user (Task 8)
│   │   ├── auth/{sign-up,sign-in,sign-out}/route.ts   # (Task 10)
│   │   └── spaces/route.ts          # list my spaces (Task 11)
│   ├── composition/                 # container, defineRoute binding, OpenAPI document (Tasks 8, 10, 11)
│   ├── shared/
│   │   ├── kernel/                  # Result, DomainError, Id, LocalDate, Clock, Money, PeriodPolicy, AuthUser, TransactionManager
│   │   ├── http/                    # problem+json, request id, defineRoute, contracts, idempotency, pagination, etag
│   │   └── infrastructure/          # env, db client, transaction manager, clock/id adapters, idempotency store
│   └── modules/
│       ├── identity/                # auth use cases, Better Auth adapter, auth schema, contracts
│       └── spaces/                  # Space entity, personal space use cases, repository, contracts
└── tests/
    ├── architecture/                # boundary rule tests + fixtures (Task 2)
    ├── support/                     # Testcontainers global setup, helpers (Task 6)
    └── acceptance/                  # DB-backed HTTP flows (Tasks 10, 11)
```

Test layout: unit tests sit next to the code as `*.test.ts`; integration tests that need PostgreSQL are `*.int.test.ts`; acceptance flows are `tests/acceptance/**/*.test.ts`. Acceptance tests call the exported route handlers in-process with real `Request` objects and a real PostgreSQL container; the CI image smoke test (Task 13) and the local production smoke test (Task 12) exercise the real Next.js server.

---

### Task 1: Bootstrap the repository with pinned versions

Implements HU-E0-01 (issue #1) except the containerized dev stack scenario, which Task 6 completes.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitattributes`, `.gitignore`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`
- Create: `src/app/api/v1/health/route.ts` (temporary liveness handler; Task 8 rewrites it)
- Create: `scripts/check-pinned.mjs`
- Create: `docs/stack-versions.md`, `README.md`
- Test: `scripts/check-pinned.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: pnpm scripts used by every later task — `dev`, `build`, `start`, `lint`, `lint:boundaries` (wired in Task 2), `typecheck`, `format`, `format:check`, `check:pinned`, `test`, `test:unit`; Vitest project `unit`; path alias `@/*` → `src/*`; `findUnpinned(pkg: object): { field: string; name: string; spec: string }[]` exported from `scripts/check-pinned.mjs`.

- [ ] **Step 1: Create the branch and normalize line endings**

```bash
git checkout -b feat/m0-walking-skeleton
```

`.gitattributes`:

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
```

```bash
git add .gitattributes
git add --renormalize .
git commit -m "chore: normalize line endings to LF"
```

- [ ] **Step 2: Write the tool and editor configuration**

`.nvmrc`:

```
24.21.0
```

`package.json`:

```json
{
  "name": "hearth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.11.2",
  "engines": { "node": "24.21.0" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "lint:boundaries": "depcruise src --config .dependency-cruiser.cjs",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "check:pinned": "node scripts/check-pinned.mjs",
    "test": "vitest run",
    "test:unit": "vitest run --project unit"
  }
}
```

`pnpm-workspace.yaml` (pnpm 11+ reads settings here; build scripts are blocked unless allowed):

```yaml
allowBuilds:
  esbuild: true
  sharp: true
  unrs-resolver: true
```

`.gitignore`:

```gitignore
node_modules/
.next/
out/
coverage/
next-env.d.ts
*.tsbuildinfo
.env
.env.*
!.env.example
!.env.production.example
```

`.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

`.prettierrc.json`:

```json
{ "printWidth": 110, "singleQuote": false, "trailingComma": "all" }
```

`.prettierignore`:

```
pnpm-lock.yaml
drizzle/
openapi/openapi.snapshot.json
.next/
docs/
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowJs": true,
    "jsx": "react-jsx",
    "noEmit": true,
    "incremental": true,
    "types": ["node"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", ".next/types/**/*.ts", "src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "scripts/**/*.mjs", "*.ts"],
  "exclude": ["node_modules", "tests/architecture/fixtures"]
}
```

`next.config.ts`:

```ts
import type { NextConfig } from "next";

export default {
  output: "standalone",
  poweredByHeader: false,
} satisfies NextConfig;
```

`eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "coverage/**", "next-env.d.ts", "drizzle/**", "tests/architecture/fixtures/**"]),
]);
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.mjs", "tests/architecture/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
    ],
  },
});
```

`src/app/api/v1/health/route.ts`:

```ts
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json({ status: "ok" });
}
```

- [ ] **Step 3: Install the pinned dependencies**

```bash
corepack enable
pnpm add -E next@16.4.0 react@19.3.0 react-dom@19.3.0 zod@4.6.5 uuid@14.0.3
pnpm add -D -E typescript@6.0.3 @types/node@24.19.2 @types/react@19.3.0 @types/react-dom@19.3.0 eslint@9.39.5 eslint-config-next@16.4.0 typescript-eslint@8.71.1 prettier@3.9.10 vitest@5.0.3 vite@8.3.4 dependency-cruiser@18.6.0
```

Expected: install succeeds. If pnpm reports "Ignored build scripts" for a package not listed in `pnpm-workspace.yaml`, add it under `allowBuilds` with `true` and run `pnpm install` again.

- [ ] **Step 4: Write the failing test for the pin checker**

`scripts/check-pinned.test.mjs`:

```js
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findUnpinned } from "./check-pinned.mjs";

describe("findUnpinned", () => {
  it("accepts exact versions, including prereleases", () => {
    expect(findUnpinned({ dependencies: { next: "16.4.0" }, devDependencies: { x: "1.0.0-rc.4" } })).toEqual([]);
  });

  it.each(["^3.0.0", "~3.0.0", "*", "latest", ">=1.0.0", "3.x", "next"])("rejects the range %s", (spec) => {
    expect(findUnpinned({ dependencies: { zod: spec } })).toEqual([{ field: "dependencies", name: "zod", spec }]);
  });

  it("exits non-zero and names the unpinned package", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinned-"));
    const file = join(dir, "package.json");
    writeFileSync(file, JSON.stringify({ dependencies: { zod: "^3.0.0" } }));
    let output = "";
    let status = 0;
    try {
      execFileSync(process.execPath, ["scripts/check-pinned.mjs", file], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      status = error.status;
      output = String(error.stderr);
    }
    expect(status).not.toBe(0);
    expect(output).toContain("zod is not pinned to an exact version");
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm vitest run --project unit scripts/check-pinned.test.mjs`
Expected: FAIL — `Cannot find module './check-pinned.mjs'`.

- [ ] **Step 6: Implement the pin checker**

`scripts/check-pinned.mjs`:

```js
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Returns every dependency whose spec is not an exact semver version. */
export function findUnpinned(pkg) {
  const unpinned = [];
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!EXACT.test(spec)) unpinned.push({ field, name, spec });
    }
  }
  return unpinned;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? "package.json";
  const unpinned = findUnpinned(JSON.parse(readFileSync(file, "utf8")));
  if (unpinned.length > 0) {
    for (const { field, name, spec } of unpinned) {
      console.error(`${name} is not pinned to an exact version (${field}: "${spec}")`);
    }
    process.exit(1);
  }
  console.log("All dependencies are pinned to exact versions.");
}
```

- [ ] **Step 7: Run the tests and the gates**

Run: `pnpm vitest run --project unit scripts/check-pinned.test.mjs`
Expected: PASS.

Run: `pnpm format` once, then `pnpm check:pinned && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`
Expected: `All dependencies are pinned to exact versions.`; typecheck and lint exit 0; `next build` lists the route `/api/v1/health`.

Run: `pnpm install --frozen-lockfile`
Expected: succeeds without modifying `pnpm-lock.yaml` (`git status` shows no change to it).

- [ ] **Step 8: Record the stack versions**

`docs/stack-versions.md`:

```markdown
# Stack versions

Pinned on 2026-10-11 (HU-E0-01). Each entry was the latest stable release that day unless a note explains otherwise.

| Component | Version | Note |
|---|---|---|
| Node.js | 24.21.0 | Current LTS ("Krypton"); Vitest 5 and Testcontainers 12 require Node ≥ 22.12 / 22.22 |
| pnpm | 12.11.2 | `packageManager` field; settings in `pnpm-workspace.yaml` |
| Next.js | 16.4.0 | App Router, standalone output |
| React / React DOM | 19.3.0 | |
| TypeScript | 6.0.3 | 7.0.2 exists (native Go build) but typescript-eslint 8.71.1 supports `<6.1.0` |
| Zod | 4.6.5 | 4.6.6 was published on the bootstrap day; 4.6.5 kept for soak time |
| zod-openapi | 6.0.2 | OpenAPI generator (ADR 0002) |
| Drizzle ORM | 0.45.4 | 1.0 is still a release candidate |
| drizzle-kit | 0.31.11 | |
| pg | 8.23.1 | |
| Better Auth | 1.7.7 | Email/password + Bearer plugin |
| Vitest | 5.0.3 | With Vite 8.3.4 (native `resolve.tsconfigPaths`) |
| Testcontainers / @testcontainers/postgresql | 12.2.0 | |
| dependency-cruiser | 18.6.0 | Boundary gate (ADR 0001) |
| ESLint | 9.39.5 | 10.x not yet supported by eslint-config-next 16.4 plugins |
| typescript-eslint | 8.71.1 | |
| Prettier | 3.9.10 | |
| uuid | 14.0.3 | UUIDv7 ids |
| next-intl | 4.14.9 | Pinned for E9; installed when the web UI starts |
| Playwright | 1.64.0 | Pinned for E9; installed when the web UI starts |
| Tailwind CSS | 4.3.3 | Pinned for E9; installed when the web UI starts |
| PostgreSQL | 18.6 (`postgres:18.6-alpine`) | Same image in dev, tests and production |
| Caddy | 2.11.7 (`caddy:2.11.7-alpine`) | Automatic TLS |
```

`README.md`:

```markdown
# Hearth

Self-hosted household finance: personal finance, group expense splitting and allocated budgets in one app.

- Design spec: `docs/superpowers/specs/2026-10-11-hearth-design.md`
- Backlog: `docs/backlog/README.md` · Board: https://github.com/users/Facabore/projects/4
- Stack versions: `docs/stack-versions.md`

## Development

Everything runs in Docker (see "Containerized development" once Task 6 lands). With a host Node.js 24.21.0:

    corepack enable
    pnpm install --frozen-lockfile
    pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "chore: bootstrap Next.js BFF with pinned toolchain (Refs #1)"
```

---

### Task 2: Hexagonal skeleton with enforced boundaries

Implements HU-E0-02 (issue #2).

**Files:**
- Create: `.dependency-cruiser.cjs`
- Create: `src/modules/README.md`, `src/shared/kernel/.gitkeep`, `src/shared/http/.gitkeep`, `src/shared/infrastructure/.gitkeep`, `src/composition/.gitkeep`
- Create: `docs/adr/0001-boundary-enforcement-with-dependency-cruiser.md`
- Create fixtures under `tests/architecture/fixtures/` (listed in Step 1)
- Test: `tests/architecture/boundaries.test.ts`

**Interfaces:**
- Consumes: `lint:boundaries` script (Task 1).
- Produces: rule names other tasks must respect — `domain-must-be-pure`, `kernel-must-be-pure`, `application-must-not-depend-on-adapters`, `modules-only-through-public-application-api`, `shared-must-not-depend-on-modules`, `no-circular`. Every module exposes its public API at `src/modules/<module>/application/index.ts`.

- [ ] **Step 1: Write the fixtures and the failing test**

Fixture files (each fixture is a tiny tree rooted at its own folder, so paths start with `src/`):

`tests/architecture/fixtures/domain-imports-orm/src/modules/ledger/domain/transaction.ts`:

```ts
import { pgTable } from "drizzle-orm/pg-core";
export const table = pgTable;
```

`tests/architecture/fixtures/domain-imports-next/src/modules/budgeting/domain/allocation.ts`:

```ts
import { headers } from "next/headers";
export const read = headers;
```

`tests/architecture/fixtures/cross-module/src/modules/ledger/infrastructure/transaction-repository.ts`:

```ts
export const transactionRepository = {};
```

`tests/architecture/fixtures/cross-module/src/modules/balances/application/compute-balances.ts`:

```ts
import { transactionRepository } from "../../ledger/infrastructure/transaction-repository";
export const computeBalances = () => transactionRepository;
```

`tests/architecture/fixtures/allowed/src/modules/ledger/domain/transaction.ts`:

```ts
export interface Transaction {
  readonly id: string;
}
```

`tests/architecture/fixtures/allowed/src/modules/ledger/application/index.ts`:

```ts
import type { Transaction } from "../domain/transaction";
export const recordExpense = (t: Transaction) => t.id;
```

`tests/architecture/fixtures/allowed/src/modules/ledger/infrastructure/repository.ts`:

```ts
import type { Transaction } from "../domain/transaction";
export const save = (t: Transaction) => t;
```

`tests/architecture/fixtures/allowed/src/app/route.ts`:

```ts
import { recordExpense } from "../modules/ledger/application/index";
export const GET = () => recordExpense({ id: "1" });
```

`tests/architecture/boundaries.test.ts`:

```ts
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../.dependency-cruiser.cjs") as { forbidden: unknown[] };
const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

async function violations(fixture: string) {
  const result = await cruise(["src"], {
    baseDir: join(fixtures, fixture),
    validate: true,
    ruleSet: { forbidden: config.forbidden } as never,
    tsPreCompilationDeps: true,
  });
  const output = result.output as ICruiseResult;
  return output.summary.violations.map((v) => ({ rule: v.rule.name, from: v.from, to: v.to }));
}

describe("architecture boundaries", () => {
  it("fails when a domain file imports the ORM", async () => {
    const found = await violations("domain-imports-orm");
    expect(found.map((v) => v.rule)).toContain("domain-must-be-pure");
  });

  it("fails when a domain file imports Next.js", async () => {
    const found = await violations("domain-imports-next");
    expect(found.map((v) => v.rule)).toContain("domain-must-be-pure");
  });

  it("fails when a module reaches into another module's internals", async () => {
    const found = await violations("cross-module");
    expect(found.map((v) => v.rule)).toContain("modules-only-through-public-application-api");
    const rule = (config.forbidden as { name: string; comment: string }[]).find(
      (r) => r.name === "modules-only-through-public-application-api",
    );
    expect(rule?.comment).toContain("may only import another module's public application API");
  });

  it("passes allowed dependency directions", async () => {
    expect(await violations("allowed")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project unit tests/architecture`
Expected: FAIL — `Cannot find module '../../.dependency-cruiser.cjs'`.

- [ ] **Step 3: Write the rules**

`.dependency-cruiser.cjs`:

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-must-be-pure",
      severity: "error",
      comment:
        "Domain code may only import its own module's domain and src/shared/kernel: no frameworks, ORM, I/O, Node built-ins or outer layers.",
      from: { path: "^src/modules/([^/]+)/domain/" },
      to: { pathNot: ["^src/modules/$1/domain/", "^src/shared/kernel/"] },
    },
    {
      name: "kernel-must-be-pure",
      severity: "error",
      comment: "The shared kernel is pure TypeScript and imports nothing outside itself.",
      from: { path: "^src/shared/kernel/" },
      to: { pathNot: "^src/shared/kernel/" },
    },
    {
      name: "application-must-not-depend-on-adapters",
      severity: "error",
      comment:
        "Application code depends on its domain, the shared kernel and other modules' public application API; never on infrastructure, contracts, ui, app, composition, the HTTP layer, frameworks or the ORM.",
      from: { path: "^src/modules/[^/]+/application/" },
      to: {
        path: [
          "^src/modules/[^/]+/(infrastructure|contracts|ui)/",
          "^src/(app|composition)/",
          "^src/shared/(http|infrastructure)/",
          "node_modules/(next|react|react-dom|drizzle-orm|pg|better-auth|@better-auth)/",
        ],
      },
    },
    {
      name: "modules-only-through-public-application-api",
      severity: "error",
      comment:
        "Modules may only import another module's public application API (src/modules/<module>/application/index.ts).",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: "^src/modules/(?!$1/)[^/]+/", pathNot: "^src/modules/[^/]+/application/index\\.ts$" },
    },
    {
      name: "shared-must-not-depend-on-modules",
      severity: "error",
      comment: "Shared code never imports modules, the app or the composition root.",
      from: { path: "^src/shared/" },
      to: { path: "^src/(modules|app|composition)/" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: ["^tests/architecture/fixtures/", "\\.test\\.(ts|mjs)$"] },
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit tests/architecture`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the skeleton and the ADR**

Create empty `.gitkeep` files in `src/shared/kernel/`, `src/shared/http/`, `src/shared/infrastructure/`, `src/composition/`.

`src/modules/README.md`:

```markdown
# Modules

Each bounded context lives in `src/modules/<module>/` with:

- `domain/` — entities, value objects, domain services and errors. Pure TypeScript: imports only its own domain and `src/shared/kernel`.
- `application/` — use cases and ports. `application/index.ts` is the module's only public API for other modules.
- `contracts/` — Zod request/response schemas; the OpenAPI document is generated from them.
- `infrastructure/` — driven adapters (Drizzle repositories, Better Auth, external services) and `*.schema.ts` table definitions.
- `ui/` — React components for the web UI (epic E9).

Rules are enforced by `pnpm lint:boundaries` (`.dependency-cruiser.cjs`).
```

`docs/adr/0001-boundary-enforcement-with-dependency-cruiser.md`:

```markdown
# ADR 0001 — Enforce architecture boundaries with dependency-cruiser

- Status: Accepted (2026-10-11)
- Story: HU-E0-02

## Context

The spec requires hexagonal modules whose domain never depends on frameworks or I/O, and modules that talk only through public application APIs. Candidates: dependency-cruiser and eslint-plugin-boundaries.

## Decision

Use dependency-cruiser 18.6.0 as the CI gate (`pnpm lint:boundaries`).

## Consequences

- Regex rules with back-references (`$1`) express "same module" and "other module" precisely, and match package subpaths such as `drizzle-orm/pg-core`.
- It does not depend on ESLint's version or resolver plugins (ESLint is pinned to 9.x).
- Editor feedback is weaker than an ESLint plugin; eslint-plugin-boundaries can be added later for in-editor hints without replacing this gate.
```

- [ ] **Step 6: Run the gate on the real tree and commit**

Run: `pnpm lint:boundaries`
Expected: `no dependency violations found`.

```bash
git add .
git commit -m "feat(architecture): enforce hexagonal module boundaries with dependency-cruiser (Refs #2)"
```

---

### Task 3: Kernel — Result, DomainError, Id, LocalDate and Clock

Implements the Result/Id/Clock part of HU-E0-04 (issue #4). Pure TypeScript, no dependencies except the UUIDv7 adapter, which lives in `shared/infrastructure`.

**Files:**
- Create: `src/shared/kernel/domain-error.ts`
- Create: `src/shared/kernel/result.ts`
- Create: `src/shared/kernel/id.ts`
- Create: `src/shared/kernel/local-date.ts`
- Create: `src/shared/kernel/clock.ts`
- Create: `src/shared/kernel/index.ts`
- Create: `src/shared/infrastructure/system-clock.ts`
- Create: `src/shared/infrastructure/uuid-v7-id-generator.ts`
- Test: `src/shared/kernel/result.test.ts`, `src/shared/kernel/local-date.test.ts`, `src/shared/kernel/clock.test.ts`

**Interfaces:**
- Consumes: nothing (first domain code).
- Produces:
  - `interface DomainError { readonly code: string; readonly details?: Readonly<Record<string, unknown>> }`
  - `domainError(code: string, details?: Record<string, unknown>): DomainError`
  - `type Result<T, E extends DomainError = DomainError> = Ok<T> | Err<E>`; `ok(value)`, `err(error)`, `map(result, fn)`, `flatMap(result, fn)`, `isOk(result)`, `isErr(result)`
  - `type Id<B extends string> = string & { readonly __brand: B }`; `interface IdGenerator { next<B extends string>(): Id<B> }`
  - `type LocalDate = string & { readonly __brand: "LocalDate" }` (ISO `YYYY-MM-DD`); `localDate(iso: string): Result<LocalDate>`, `fromParts(year, month, day): LocalDate`, `partsOf(date): { year: number; month: number; day: number }`, `daysInMonth(year, month): number`, `addDays(date, days): LocalDate`, `addMonths(year, month, delta): { year: number; month: number }`
  - `interface Clock { now(): Date }`; `todayIn(clock: Clock, timeZone: string): LocalDate`
  - `class FixedClock implements Clock` (kernel, pure, for tests and deterministic use cases); `class SystemClock implements Clock` (infrastructure)
  - `class UuidV7IdGenerator implements IdGenerator`

- [ ] **Step 1: Write the failing tests**

`src/shared/kernel/result.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { domainError } from "./domain-error";
import { err, flatMap, isErr, isOk, map, ok, type Result } from "./result";

const failingUseCase = (): Result<number> => err(domainError("NotASpaceMember", { memberId: "m-1" }));

describe("Result", () => {
  it("carries a typed domain error without throwing", () => {
    expect(() => failingUseCase()).not.toThrow();
    const result = failingUseCase();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NotASpaceMember");
  });

  it("maps only successful values", () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
    const failure = err(domainError("X"));
    expect(map(failure, (n: number) => n * 10)).toBe(failure);
  });

  it("chains with flatMap and short-circuits on the first error", () => {
    const half = (n: number): Result<number> => (n % 2 === 0 ? ok(n / 2) : err(domainError("Odd")));
    expect(flatMap(ok(8), half)).toEqual(ok(4));
    const chained = flatMap(flatMap(ok(6), half), half);
    expect(isErr(chained) && chained.error.code).toBe("Odd");
    expect(isOk(ok(1))).toBe(true);
  });
});
```

`src/shared/kernel/local-date.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysInMonth, fromParts, localDate, partsOf } from "./local-date";
import { isErr, isOk } from "./result";

describe("LocalDate", () => {
  it("accepts valid ISO dates and rejects impossible ones", () => {
    expect(isOk(localDate("2028-02-29"))).toBe(true);
    const bad = localDate("2027-02-29");
    expect(isErr(bad) && bad.error.code).toBe("InvalidDate");
    expect(isErr(localDate("2026-1-5"))).toBe(true);
  });

  it("knows month lengths including leap years", () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays(fromParts(2026, 12, 31), 1)).toBe("2027-01-01");
    expect(addDays(fromParts(2026, 11, 1), -1)).toBe("2026-10-31");
  });

  it("adds months across years", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("splits into parts", () => {
    expect(partsOf(fromParts(2026, 3, 9))).toEqual({ year: 2026, month: 3, day: 9 });
  });
});
```

`src/shared/kernel/clock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, todayIn } from "./clock";

describe("todayIn", () => {
  it("computes today in the space timezone", () => {
    const clock = new FixedClock(new Date("2026-11-01T04:30:00Z"));
    expect(todayIn(clock, "America/Bogota")).toBe("2026-10-31");
    expect(todayIn(clock, "UTC")).toBe("2026-11-01");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit src/shared/kernel`
Expected: FAIL — `Cannot find module './result'` (and the other kernel modules).

- [ ] **Step 3: Write the implementation**

`src/shared/kernel/domain-error.ts`:

```ts
export interface DomainError {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const domainError = (code: string, details?: Record<string, unknown>): DomainError =>
  details === undefined ? { code } : { code, details };
```

`src/shared/kernel/result.ts`:

```ts
import type { DomainError } from "./domain-error";

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E extends DomainError = DomainError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E extends DomainError>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E extends DomainError>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E extends DomainError>(r: Result<T, E>): r is Err<E> => !r.ok;

export const map = <T, U, E extends DomainError>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  r.ok ? ok(fn(r.value)) : r;

export const flatMap = <T, U, E extends DomainError>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (r.ok ? fn(r.value) : r);
```

`src/shared/kernel/id.ts`:

```ts
export type Id<B extends string> = string & { readonly __brand: B };

export interface IdGenerator {
  next<B extends string>(): Id<B>;
}
```

`src/shared/kernel/local-date.ts`:

```ts
import { domainError } from "./domain-error";
import { err, ok, type Result } from "./result";

export type LocalDate = string & { readonly __brand: "LocalDate" };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const fromParts = (year: number, month: number, day: number): LocalDate =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}` as LocalDate;

export const partsOf = (date: LocalDate): { year: number; month: number; day: number } => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
};

export const localDate = (iso: string): Result<LocalDate> => {
  const match = ISO.exec(iso);
  if (!match) return err(domainError("InvalidDate", { value: iso }));
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return err(domainError("InvalidDate", { value: iso }));
  }
  return ok(iso as LocalDate);
};

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const { year, month, day } = partsOf(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return fromParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
};

export const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};
```

`src/shared/kernel/clock.ts`:

```ts
import type { LocalDate } from "./local-date";

export interface Clock {
  now(): Date;
}

export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return new Date(this.instant);
  }
}

export const todayIn = (clock: Clock, timeZone: string): LocalDate =>
  // en-CA formats as YYYY-MM-DD
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    clock.now(),
  ) as LocalDate;
```

`src/shared/infrastructure/system-clock.ts`:

```ts
import type { Clock } from "@/shared/kernel";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
```

`src/shared/infrastructure/uuid-v7-id-generator.ts`:

```ts
import { v7 } from "uuid";
import type { Id, IdGenerator } from "@/shared/kernel";

export class UuidV7IdGenerator implements IdGenerator {
  next<B extends string>(): Id<B> {
    return v7() as Id<B>;
  }
}
```

`src/shared/kernel/index.ts`:

```ts
export * from "./domain-error";
export * from "./result";
export * from "./id";
export * from "./local-date";
export * from "./clock";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/shared/kernel`
Expected: PASS (3 files).

- [ ] **Step 5: Boundary lint and commit**

Run: `pnpm lint:boundaries`
Expected: exit 0 (kernel imports nothing outside `src/shared/kernel`).

```bash
git add src/shared/kernel src/shared/infrastructure/system-clock.ts src/shared/infrastructure/uuid-v7-id-generator.ts
git commit -m "feat(kernel): add Result, DomainError, Id, LocalDate and Clock"
```

---

### Task 4: Kernel — Money value object

Implements HU-E0-03 (issue #3).

**Files:**
- Create: `src/shared/kernel/currency.ts`
- Create: `src/shared/kernel/money.ts`
- Modify: `src/shared/kernel/index.ts` (export the two new files)
- Test: `src/shared/kernel/money.test.ts`

**Interfaces:**
- Consumes: `Result`, `ok`, `err`, `domainError` (Task 3).
- Produces:
  - `interface Currency { readonly code: string; readonly exponent: number; readonly roundingUnit: bigint }`; `currencyOf(code: string): Result<Currency>` (errors `UnknownCurrency`)
  - `class Money` with `static ofMinor(minor: bigint, currency: string): Result<Money>`, `static fromMajor(major: string, currency: string): Result<Money>`, `readonly minor: bigint`, `readonly currency: Currency`, `add(other): Result<Money>`, `subtract(other): Result<Money>`, `allocate(ratios: readonly number[]): Result<Money[]>`, `isZero()`, `isNegative()`, `compare(other): Result<-1 | 0 | 1>`, `equals(other): boolean`
  - Error codes: `UnknownCurrency`, `InvalidMoneyPrecision`, `CurrencyMismatch`, `InvalidRatio`

- [ ] **Step 1: Write the failing test**

`src/shared/kernel/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money } from "./money";
import { isErr, type Result } from "./result";

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`unexpected error ${r.error.code}`);
  return r.value;
};
const cop = (major: string) => unwrap(Money.fromMajor(major, "COP"));
const majors = (parts: Money[]) => parts.map((p) => p.minor / 100n);

describe("Money", () => {
  it("is stored as bigint minor units", () => {
    const money = cop("1600000");
    expect(money.minor).toBe(160000000n);
    expect(money.currency.code).toBe("COP");
  });

  it("rejects adding different currencies", () => {
    const usd = unwrap(Money.fromMajor("50", "USD"));
    const result = cop("100000").add(usd);
    expect(isErr(result) && result.error.code).toBe("CurrencyMismatch");
  });

  it("allocates by ratio preserving the total", () => {
    expect(majors(unwrap(cop("1470000").allocate([40, 60])))).toEqual([588000n, 882000n]);
  });

  it("allocates remainders in the currency rounding unit, deterministically", () => {
    const first = unwrap(cop("100000").allocate([1, 1, 1]));
    expect(majors(first)).toEqual([33334n, 33333n, 33333n]);
    expect(first.reduce((sum, p) => sum + p.minor, 0n)).toBe(10000000n);
    expect(majors(unwrap(cop("100000").allocate([1, 1, 1])))).toEqual([33334n, 33333n, 33333n]);
  });

  it("gives largest remainders first and breaks ties by input order", () => {
    // 100 pesos by 1:2:2 -> exact 20, 40, 40 ; 101 pesos -> 20.2, 40.4, 40.4 -> +1 to index 1
    expect(majors(unwrap(cop("101").allocate([1, 2, 2])))).toEqual([20n, 41n, 40n]);
  });

  it("rejects fractional minor units", () => {
    const result = Money.fromMajor("10.005", "COP");
    expect(isErr(result) && result.error.code).toBe("InvalidMoneyPrecision");
  });

  it("rejects invalid ratios and unknown currencies", () => {
    expect(isErr(cop("10").allocate([]))).toBe(true);
    expect(isErr(cop("10").allocate([0, 0]))).toBe(true);
    expect(isErr(cop("10").allocate([1.5, 1]))).toBe(true);
    const unknown = Money.fromMajor("1", "XXX");
    expect(isErr(unknown) && unknown.error.code).toBe("UnknownCurrency");
  });

  it("compares, adds and subtracts", () => {
    expect(unwrap(cop("5").add(cop("7"))).minor).toBe(1200n);
    expect(unwrap(cop("5").subtract(cop("7"))).isNegative()).toBe(true);
    expect(unwrap(cop("5").compare(cop("7")))).toBe(-1);
    expect(cop("0").isZero()).toBe(true);
    expect(cop("3").equals(cop("3"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/shared/kernel/money.test.ts`
Expected: FAIL — `Cannot find module './money'`.

- [ ] **Step 3: Write the implementation**

`src/shared/kernel/currency.ts`:

```ts
import { domainError } from "./domain-error";
import { err, ok, type Result } from "./result";

export interface Currency {
  readonly code: string;
  /** ISO 4217 minor-unit exponent. */
  readonly exponent: number;
  /** Smallest amount used for splits and allocations, in minor units (spec 5.3). */
  readonly roundingUnit: bigint;
}

const CURRENCIES: Readonly<Record<string, Currency>> = {
  COP: { code: "COP", exponent: 2, roundingUnit: 100n },
  USD: { code: "USD", exponent: 2, roundingUnit: 1n },
  EUR: { code: "EUR", exponent: 2, roundingUnit: 1n },
};

export const currencyOf = (code: string): Result<Currency> => {
  const currency = CURRENCIES[code];
  return currency ? ok(currency) : err(domainError("UnknownCurrency", { currency: code }));
};
```

`src/shared/kernel/money.ts`:

```ts
import { currencyOf, type Currency } from "./currency";
import { domainError } from "./domain-error";
import { err, flatMap, map, ok, type Result } from "./result";

const MAJOR = /^(-?)(\d+)(?:\.(\d+))?$/;

export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: Currency,
  ) {}

  static ofMinor(minor: bigint, currency: string): Result<Money> {
    return map(currencyOf(currency), (c) => new Money(minor, c));
  }

  /** Parses a decimal string such as "1600000" or "12.50"; never accepts floats. */
  static fromMajor(major: string, currency: string): Result<Money> {
    return flatMap(currencyOf(currency), (c) => {
      const match = MAJOR.exec(major);
      if (!match) return err(domainError("InvalidMoneyPrecision", { value: major }));
      const [, sign, whole, fraction = ""] = match;
      if (fraction.length > c.exponent) return err(domainError("InvalidMoneyPrecision", { value: major }));
      const minor = BigInt(`${whole}${fraction.padEnd(c.exponent, "0")}`);
      return ok(new Money(sign === "-" ? -minor : minor, c));
    });
  }

  add(other: Money): Result<Money> {
    return this.sameCurrency(other) ? ok(new Money(this.minor + other.minor, this.currency)) : this.mismatch(other);
  }

  subtract(other: Money): Result<Money> {
    return this.sameCurrency(other) ? ok(new Money(this.minor - other.minor, this.currency)) : this.mismatch(other);
  }

  compare(other: Money): Result<-1 | 0 | 1> {
    if (!this.sameCurrency(other)) return this.mismatch(other);
    return ok(this.minor === other.minor ? 0 : this.minor < other.minor ? -1 : 1);
  }

  equals(other: Money): boolean {
    return this.sameCurrency(other) && this.minor === other.minor;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  /**
   * Largest-remainder allocation in the currency rounding unit (spec 5.3).
   * Ties go to the earlier ratio. A sub-unit remainder (amount not a multiple
   * of the rounding unit) is added to the first part.
   */
  allocate(ratios: readonly number[]): Result<Money[]> {
    if (ratios.length === 0 || ratios.some((r) => !Number.isInteger(r) || r < 0)) {
      return err(domainError("InvalidRatio", { ratios }));
    }
    const weights = ratios.map(BigInt);
    const totalWeight = weights.reduce((a, b) => a + b, 0n);
    if (totalWeight === 0n) return err(domainError("InvalidRatio", { ratios }));

    const unit = this.currency.roundingUnit;
    const units = this.minor / unit;
    const subUnit = this.minor % unit;

    const shares = weights.map((w, index) => ({ index, base: (units * w) / totalWeight, rem: (units * w) % totalWeight }));
    let leftover = units - shares.reduce((sum, s) => sum + s.base, 0n);
    const order = [...shares].sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
    for (const share of order) {
      if (leftover <= 0n) break;
      share.base += 1n;
      leftover -= 1n;
    }
    return ok(
      shares.map((s) => new Money(s.base * unit + (s.index === 0 ? subUnit : 0n), this.currency)),
    );
  }

  private sameCurrency(other: Money): boolean {
    return this.currency.code === other.currency.code;
  }

  private mismatch<T>(other: Money): Result<T> {
    return err(domainError("CurrencyMismatch", { left: this.currency.code, right: other.currency.code }));
  }
}
```

Note: `allocate` is written for non-negative amounts (shares and allocations); negative amounts never reach it in M0–M4.

Append to `src/shared/kernel/index.ts`:

```ts
export * from "./currency";
export * from "./money";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/shared/kernel/money.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/kernel
git commit -m "feat(kernel): add Money value object with largest-remainder allocation"
```

---

### Task 5: Kernel — PeriodPolicy

Implements the PeriodPolicy part of HU-E0-04 (issue #4).

**Files:**
- Create: `src/shared/kernel/period-policy.ts`
- Modify: `src/shared/kernel/index.ts`
- Test: `src/shared/kernel/period-policy.test.ts`

**Interfaces:**
- Consumes: `LocalDate`, `fromParts`, `partsOf`, `daysInMonth`, `addDays`, `addMonths`, `Result`, `domainError` (Task 3).
- Produces:
  - `type PeriodPolicy = { readonly kind: "MONTHLY"; readonly day: number } | { readonly kind: "SEMI_MONTHLY"; readonly day1: number; readonly day2: number }`
  - `interface Period { readonly start: LocalDate; readonly end: LocalDate; readonly label: string }`
  - `monthly(day: number): Result<PeriodPolicy>`, `semiMonthly(day1: number, day2: number): Result<PeriodPolicy>` (error `InvalidPeriodPolicy`)
  - `DEFAULT_PERIOD_POLICY: PeriodPolicy` (= MONTHLY(1))
  - `periodFor(policy: PeriodPolicy, date: LocalDate): Period`

- [ ] **Step 1: Write the failing test**

`src/shared/kernel/period-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { localDate, type LocalDate } from "./local-date";
import { DEFAULT_PERIOD_POLICY, monthly, periodFor, semiMonthly, type PeriodPolicy } from "./period-policy";
import { isErr, type Result } from "./result";

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
const d = (iso: string): LocalDate => unwrap(localDate(iso));

describe("PeriodPolicy", () => {
  it.each([
    [1, "2026-10-31", "2026-10-01", "2026-10-31", "2026-10"],
    [1, "2026-11-01", "2026-11-01", "2026-11-30", "2026-11"],
    [15, "2026-11-20", "2026-11-15", "2026-12-14", "2026-11"],
    [25, "2026-10-24", "2026-09-25", "2026-10-24", "2026-10"],
    [25, "2026-10-25", "2026-10-25", "2026-11-24", "2026-11"],
  ])("MONTHLY(%i) puts %s in %s..%s labelled %s", (day, date, start, end, label) => {
    expect(periodFor(unwrap(monthly(day)), d(date))).toEqual({ start, end, label });
  });

  it.each([
    ["2027-02-27", "2027-01-31", "2027-02-27"],
    ["2027-02-28", "2027-02-28", "2027-03-30"],
    ["2028-02-29", "2028-02-29", "2028-03-30"],
  ])("MONTHLY(31) clamps short months: %s in %s..%s", (date, start, end) => {
    const period = periodFor(unwrap(monthly(31)), d(date));
    expect([period.start, period.end]).toEqual([start, end]);
  });

  it.each([
    [1, 16, "2026-11-10", "2026-11-01", "2026-11-15", "2026-11 H1"],
    [1, 16, "2026-11-20", "2026-11-16", "2026-11-30", "2026-11 H2"],
    [5, 20, "2026-11-03", "2026-10-20", "2026-11-04", "2026-10 H2"],
  ])("SEMI_MONTHLY(%i, %i) puts %s in %s..%s labelled %s", (day1, day2, date, start, end, label) => {
    expect(periodFor(unwrap(semiMonthly(day1, day2)), d(date))).toEqual({ start, end, label });
  });

  it.each<[string, Result<PeriodPolicy>]>([
    ["MONTHLY(0)", monthly(0)],
    ["MONTHLY(32)", monthly(32)],
    ["MONTHLY(1.5)", monthly(1.5)],
    ["SEMI_MONTHLY(16, 16)", semiMonthly(16, 16)],
    ["SEMI_MONTHLY(20, 5)", semiMonthly(20, 5)],
  ])("rejects %s", (_name, result) => {
    expect(isErr(result) && result.error.code).toBe("InvalidPeriodPolicy");
  });

  it("defaults to MONTHLY(1)", () => {
    expect(DEFAULT_PERIOD_POLICY).toEqual({ kind: "MONTHLY", day: 1 });
  });

  it("collapses semi-monthly anchors that clamp to the same day", () => {
    // SEMI_MONTHLY(29, 31) in February 2027: both anchors clamp to the 28th
    const period = periodFor(unwrap(semiMonthly(29, 31)), d("2027-02-28"));
    expect(period.start).toBe("2027-02-28");
    expect(period.end).toBe("2027-03-28");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/shared/kernel/period-policy.test.ts`
Expected: FAIL — `Cannot find module './period-policy'`.

- [ ] **Step 3: Write the implementation**

`src/shared/kernel/period-policy.ts`:

```ts
import { domainError } from "./domain-error";
import { addDays, addMonths, daysInMonth, fromParts, partsOf, type LocalDate } from "./local-date";
import { err, ok, type Result } from "./result";

export type PeriodPolicy =
  | { readonly kind: "MONTHLY"; readonly day: number }
  | { readonly kind: "SEMI_MONTHLY"; readonly day1: number; readonly day2: number };

export interface Period {
  readonly start: LocalDate;
  readonly end: LocalDate;
  readonly label: string;
}

const isAnchorDay = (day: number) => Number.isInteger(day) && day >= 1 && day <= 31;
const invalid = (details: Record<string, unknown>) => err(domainError("InvalidPeriodPolicy", details));

export const monthly = (day: number): Result<PeriodPolicy> =>
  isAnchorDay(day) ? ok({ kind: "MONTHLY", day }) : invalid({ day });

export const semiMonthly = (day1: number, day2: number): Result<PeriodPolicy> =>
  isAnchorDay(day1) && isAnchorDay(day2) && day1 < day2
    ? ok({ kind: "SEMI_MONTHLY", day1, day2 })
    : invalid({ day1, day2 });

export const DEFAULT_PERIOD_POLICY: PeriodPolicy = { kind: "MONTHLY", day: 1 };

interface Anchor {
  readonly date: LocalDate;
  /** Index of the anchor day within the policy (0 = day / day1, 1 = day2). */
  readonly slot: number;
}

const anchorDays = (policy: PeriodPolicy): number[] =>
  policy.kind === "MONTHLY" ? [policy.day] : [policy.day1, policy.day2];

/** Anchors of one month, clamped to its length, duplicates collapsed (first slot wins). */
const anchorsOf = (policy: PeriodPolicy, year: number, month: number): Anchor[] => {
  const last = daysInMonth(year, month);
  const anchors: Anchor[] = [];
  anchorDays(policy).forEach((day, slot) => {
    const date = fromParts(year, month, Math.min(day, last));
    if (!anchors.some((a) => a.date === date)) anchors.push({ date, slot });
  });
  return anchors;
};

const label = (policy: PeriodPolicy, start: Anchor): string => {
  const { year, month } = partsOf(start.date);
  if (policy.kind === "SEMI_MONTHLY") return `${fromParts(year, month, 1).slice(0, 7)} ${start.slot === 0 ? "H1" : "H2"}`;
  // MONTHLY: the month containing most days of the period (spec 5.3)
  const labelled = policy.day <= 15 ? { year, month } : addMonths(year, month, 1);
  return fromParts(labelled.year, labelled.month, 1).slice(0, 7);
};

export const periodFor = (policy: PeriodPolicy, date: LocalDate): Period => {
  const { year, month } = partsOf(date);
  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);
  const candidates = [
    ...anchorsOf(policy, prev.year, prev.month),
    ...anchorsOf(policy, year, month),
    ...anchorsOf(policy, next.year, next.month),
  ];
  const startIndex = candidates.findLastIndex((a) => a.date <= date);
  const start = candidates[startIndex]!;
  const following = candidates[startIndex + 1]!;
  return { start: start.date, end: addDays(following.date, -1), label: label(policy, start) };
};
```

Why three months of candidates: the start anchor is in the current or previous month, and the following anchor is in the current or next month; ISO strings compare correctly with `<=`.

Append to `src/shared/kernel/index.ts`:

```ts
export * from "./period-policy";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/shared/kernel/period-policy.test.ts`
Expected: PASS (all outline rows).

- [ ] **Step 5: Commit**

```bash
git add src/shared/kernel
git commit -m "feat(kernel): add PeriodPolicy with monthly cut-off and semi-monthly periods"
```

---

### Task 6: PostgreSQL, migrations, transactions and the containerized dev stack

Implements HU-E0-05 (issue #5) and completes HU-E0-01's containerized-development scenario (issue #1).

**Files:**
- Create: `src/shared/kernel/transaction-manager.ts`; Modify: `src/shared/kernel/index.ts`
- Create: `src/shared/infrastructure/env.ts`
- Create: `src/shared/infrastructure/db/client.ts`
- Create: `src/shared/infrastructure/db/drizzle-transaction-manager.ts`
- Create: `src/shared/infrastructure/idempotency.schema.ts`
- Create: `scripts/migrate.mjs`, `scripts/db-check.mjs`, `drizzle.config.ts`, `drizzle/` (generated)
- Create: `tests/support/postgres-global-setup.ts`, `tests/support/vitest-context.d.ts`, `tests/support/database.ts`
- Create: `compose.dev.yaml`, `.env.example`
- Modify: `package.json` (scripts), `vitest.config.ts` (integration and acceptance projects), `README.md`
- Test: `src/shared/infrastructure/env.test.ts`, `src/shared/infrastructure/db/migrations.int.test.ts`, `src/shared/infrastructure/db/bigint-roundtrip.int.test.ts`, `src/shared/infrastructure/db/drizzle-transaction-manager.int.test.ts`

**Interfaces:**
- Consumes: `Result`, `Err`, `DomainError`, `ok`, `err`, `domainError` (Task 3).
- Produces:
  - `interface TransactionManager { run<T>(work: () => Promise<Result<T>>): Promise<Result<T>> }` (kernel)
  - `type Database = NodePgDatabase`; `type Executor = PgDatabase<NodePgQueryResultHKT>`; `createDatabase(url: string): { db: Database; pool: Pool }`
  - `class DrizzleTransactionManager implements TransactionManager` with `executor(): Executor`
  - `interface Env { DATABASE_URL: string; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string; APP_TIMEZONE: string; LOG_LEVEL: "debug" | "info" | "warn" | "error" }`; `loadEnv(source?): Env` (throws `EnvError` naming every missing/invalid variable)
  - `runMigrations(url: string, migrationsFolder?: string): Promise<void>` from `scripts/migrate.mjs`
  - table `idempotencyKeys` (`idempotency_keys`) used by Task 9
  - Vitest provided context `databaseUrl`, `adminDatabaseUrl`; helper `testDatabase(): { db: Database; pool: Pool }`
  - pnpm scripts `db:generate`, `db:migrate`, `db:check`, `test:int`, `test:acceptance`

- [ ] **Step 1: Install the database dependencies**

```bash
pnpm add -E drizzle-orm@0.45.4 pg@8.23.1
pnpm add -D -E drizzle-kit@0.31.11 @types/pg@8.23.1 testcontainers@12.2.0 @testcontainers/postgresql@12.2.0
```

Add to `package.json` `scripts`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "node scripts/migrate.mjs",
"db:check": "node scripts/db-check.mjs",
"test:int": "vitest run --project integration",
"test:acceptance": "vitest run --project acceptance"
```

- [ ] **Step 2: Write the failing env test**

`src/shared/infrastructure/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://hearth:hearth@db:5432/hearth",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://hearth.example.com",
};

describe("loadEnv", () => {
  it("parses a valid environment with defaults", () => {
    expect(loadEnv(valid)).toEqual({ ...valid, APP_TIMEZONE: "America/Bogota", LOG_LEVEL: "info" });
  });

  it("names every missing or invalid variable", () => {
    const { BETTER_AUTH_SECRET: _omit, ...rest } = valid;
    expect(() => loadEnv({ ...rest, DATABASE_URL: "mysql://nope" })).toThrow(
      new EnvError("Missing or invalid environment variables: BETTER_AUTH_SECRET, DATABASE_URL"),
    );
  });

  it("rejects a short secret", () => {
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
```

Run: `pnpm vitest run --project unit src/shared/infrastructure/env.test.ts`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 3: Implement env loading**

`src/shared/infrastructure/env.ts`:

```ts
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_TIMEZONE: z.string().min(1).default("America/Bogota"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  override readonly name = "EnvError";
}

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
  throw new EnvError(`Missing or invalid environment variables: ${names.join(", ")}`);
};
```

Run: `pnpm vitest run --project unit src/shared/infrastructure/env.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the database client, the transaction manager port and the first schema**

`src/shared/kernel/transaction-manager.ts`:

```ts
import type { Result } from "./result";

export interface TransactionManager {
  /**
   * Runs `work` in one database transaction. An `Err` result or a thrown error rolls
   * everything back. Nested calls join the outer transaction.
   */
  run<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
}
```

Append to `src/shared/kernel/index.ts`:

```ts
export * from "./transaction-manager";
```

`src/shared/infrastructure/db/client.ts`:

```ts
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool } from "pg";

export type Database = NodePgDatabase;
/** The database or an open transaction; repositories write through this. */
export type Executor = PgDatabase<NodePgQueryResultHKT>;

export const createDatabase = (url: string): { db: Database; pool: Pool } => {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { db: drizzle({ client: pool }), pool };
};
```

`src/shared/infrastructure/db/drizzle-transaction-manager.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type { DomainError, Err, Result, TransactionManager } from "@/shared/kernel";
import type { Database, Executor } from "./client";

class RollbackForResult extends Error {
  constructor(readonly result: Err<DomainError>) {
    super("rollback requested by an Err result");
  }
}

export class DrizzleTransactionManager implements TransactionManager {
  private readonly storage = new AsyncLocalStorage<Executor>();

  constructor(private readonly db: Database) {}

  /** The open transaction of the current async context, or the database. */
  executor(): Executor {
    return this.storage.getStore() ?? this.db;
  }

  async run<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.storage.getStore()) return work();
    try {
      return await this.db.transaction((tx) =>
        this.storage.run(tx, async () => {
          const result = await work();
          if (!result.ok) throw new RollbackForResult(result);
          return result;
        }),
      );
    } catch (error) {
      if (error instanceof RollbackForResult) return error.result;
      throw error;
    }
  }
}
```

`src/shared/infrastructure/idempotency.schema.ts`:

```ts
import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: text("user_id").notNull(),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    responseHeaders: jsonb("response_headers").$type<[string, string][]>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.route, t.key] })],
);
```

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/**/*.schema.ts",
  out: process.env.DRIZZLE_OUT ?? "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://hearth:hearth@localhost:5432/hearth" },
});
```

- [ ] **Step 5: Write the migration runner and generate the first migration**

`scripts/migrate.mjs`:

```js
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { pathToFileURL } from "node:url";

/** Applies every pending migration in `migrationsFolder` to the database at `url`. */
export async function runMigrations(url, migrationsFolder = "drizzle") {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Missing or invalid environment variables: DATABASE_URL");
    process.exit(1);
  }
  await runMigrations(url, process.env.MIGRATIONS_FOLDER ?? "drizzle");
  console.log("Migrations applied.");
}
```

Run: `pnpm db:generate --name init`
Expected: creates `drizzle/0000_init.sql` with `CREATE TABLE "idempotency_keys"` and `drizzle/meta/_journal.json`.

- [ ] **Step 6: Write the Testcontainers harness**

`tests/support/vitest-context.d.ts`:

```ts
declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    adminDatabaseUrl: string;
  }
}

export {};
```

`tests/support/postgres-global-setup.ts`:

```ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../scripts/migrate.mjs";

export const POSTGRES_IMAGE = "postgres:18.6-alpine";

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("hearth")
    .withUsername("hearth")
    .withPassword("hearth")
    .start();
  const url = container.getConnectionUri();
  await runMigrations(url, "drizzle");
  project.provide("databaseUrl", url);
  project.provide("adminDatabaseUrl", url.replace(/\/hearth$/, "/postgres"));
  return async () => {
    await container.stop();
  };
}
```

`tests/support/database.ts`:

```ts
import { inject } from "vitest";
import { createDatabase } from "@/shared/infrastructure/db/client";

export const testDatabase = () => createDatabase(inject("databaseUrl"));
```

Replace `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

const dbProject = { globalSetup: ["./tests/support/postgres-global-setup.ts"], testTimeout: 60_000, hookTimeout: 180_000 };

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.mjs", "tests/architecture/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
      { test: { name: "integration", include: ["src/**/*.int.test.ts"], ...dbProject } },
      { test: { name: "acceptance", include: ["tests/acceptance/**/*.test.ts"], fileParallelism: false, ...dbProject } },
    ],
  },
});
```

- [ ] **Step 7: Write the failing integration tests**

`src/shared/infrastructure/db/migrations.int.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };
const dbName = `m_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("migrations", () => {
  it("apply to an empty database and are idempotent", async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = inject("adminDatabaseUrl").replace(/\/postgres$/, `/${dbName}`);

    await runMigrations(url);
    await runMigrations(url);

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const { rows } = await client.query("SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations");
    await client.end();
    expect(rows[0].applied).toBe(journal.entries.length);
  });
});
```

`src/shared/infrastructure/db/bigint-roundtrip.int.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { bigint, pgTable, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";

const moneyProbe = pgTable("money_probe", {
  id: uuid("id").primaryKey().defaultRandom(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
});
const { db, pool } = testDatabase();

beforeAll(() => db.execute(sql`CREATE TABLE IF NOT EXISTS money_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount bigint NOT NULL)`));
afterAll(() => pool.end());

describe("bigint money columns", () => {
  it("save and reload 160000000 minor units exactly as a bigint", async () => {
    const [saved] = await db.insert(moneyProbe).values({ amount: 160000000n }).returning();
    const [reloaded] = await db.select().from(moneyProbe).where(eq(moneyProbe.id, saved!.id));
    expect(typeof reloaded!.amount).toBe("bigint");
    expect(reloaded!.amount).toBe(160000000n);
  });
});
```

`src/shared/infrastructure/db/drizzle-transaction-manager.int.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { domainError, err, ok } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { DrizzleTransactionManager } from "./drizzle-transaction-manager";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const count = async () => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM tm_probe");
  return rows[0].n as number;
};
const insertTwo = async () => {
  await tm.executor().execute(sql`INSERT INTO tm_probe (id) VALUES (1)`);
  await tm.executor().execute(sql`INSERT INTO tm_probe (id) VALUES (2)`);
};

beforeAll(() => db.execute(sql`CREATE TABLE IF NOT EXISTS tm_probe (id int PRIMARY KEY)`));
beforeEach(() => db.execute(sql`TRUNCATE tm_probe`));
afterAll(() => pool.end());

describe("DrizzleTransactionManager", () => {
  it("commits when the work succeeds", async () => {
    const result = await tm.run(async () => {
      await insertTwo();
      return ok("done");
    });
    expect(result).toEqual(ok("done"));
    expect(await count()).toBe(2);
  });

  it("rolls back both rows when the work returns an Err", async () => {
    const result = await tm.run(async () => {
      await insertTwo();
      return err(domainError("Boom"));
    });
    expect(result.ok).toBe(false);
    expect(await count()).toBe(0);
  });

  it("rolls back and rethrows when the work throws", async () => {
    await expect(
      tm.run(async () => {
        await insertTwo();
        throw new Error("crash");
      }),
    ).rejects.toThrow("crash");
    expect(await count()).toBe(0);
  });

  it("joins the outer transaction when nested", async () => {
    const result = await tm.run(async () => {
      await tm.executor().execute(sql`INSERT INTO tm_probe (id) VALUES (1)`);
      await tm.run(async () => {
        await tm.executor().execute(sql`INSERT INTO tm_probe (id) VALUES (2)`);
        return ok(null);
      });
      return err(domainError("OuterFails"));
    });
    expect(result.ok).toBe(false);
    expect(await count()).toBe(0);
  });
});
```

- [ ] **Step 8: Run the integration tests**

Docker must be running.

Run: `pnpm test:int`
Expected: PASS (3 files, 6 tests). If the implementation from Steps 4–5 is temporarily removed, the same command fails with module-not-found errors; that is the red state for these tests.

- [ ] **Step 9: Write the schema drift gate and verify it**

`scripts/db-check.mjs`:

```js
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "hearth-db-check-"));
cpSync("drizzle", out, { recursive: true });
const before = new Set(readdirSync(out).filter((f) => f.endsWith(".sql")));
try {
  execFileSync("pnpm", ["exec", "drizzle-kit", "generate"], {
    stdio: "inherit",
    env: { ...process.env, DRIZZLE_OUT: out },
    shell: process.platform === "win32",
  });
  const added = readdirSync(out).filter((f) => f.endsWith(".sql") && !before.has(f));
  if (added.length > 0) {
    console.error(`Schema drift: a migration is missing (drizzle-kit would generate ${added.join(", ")}). Run "pnpm db:generate".`);
    process.exit(1);
  }
  console.log("No schema drift: migrations match the Drizzle schema.");
} finally {
  rmSync(out, { recursive: true, force: true });
}
```

Run: `pnpm db:check`
Expected: exit 0 with `No schema drift`.

Manual red check: add `note: text("note")` to `idempotencyKeys`, run `pnpm db:check`.
Expected: exit 1 with `Schema drift: a migration is missing`. Revert the column and confirm `pnpm db:check` exits 0 again.

- [ ] **Step 10: Write the containerized dev stack**

`compose.dev.yaml`:

```yaml
name: hearth-dev

x-node: &node
  image: node:24.21.0-alpine
  working_dir: /workspace
  environment: &node-env
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0"
    DATABASE_URL: postgres://hearth:hearth@db:5432/hearth
  volumes:
    - .:/workspace
    - node-modules:/workspace/node_modules

services:
  db:
    image: postgres:18.6-alpine
    environment:
      POSTGRES_DB: hearth
      POSTGRES_USER: hearth
      POSTGRES_PASSWORD: hearth
    ports: ["5432:5432"]
    volumes: [db-data:/var/lib/postgresql]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hearth -d hearth"]
      interval: 2s
      timeout: 3s
      retries: 30

  deps:
    <<: *node
    command: sh -c "corepack enable && pnpm install --frozen-lockfile"

  migrate:
    <<: *node
    command: sh -c "corepack enable && pnpm db:migrate"
    depends_on:
      db: { condition: service_healthy }
      deps: { condition: service_completed_successfully }

  app:
    <<: *node
    command: sh -c "corepack enable && pnpm dev --hostname 0.0.0.0"
    environment:
      <<: *node-env
      BETTER_AUTH_SECRET: dev-only-secret-0123456789abcdef0123
      BETTER_AUTH_URL: http://localhost:3000
      WATCHPACK_POLLING: "true"
      TESTCONTAINERS_HOST_OVERRIDE: host.docker.internal
    ports: ["3000:3000"]
    volumes:
      - .:/workspace
      - node-modules:/workspace/node_modules
      - next-cache:/workspace/.next
      - /var/run/docker.sock:/var/run/docker.sock
    extra_hosts: ["host.docker.internal:host-gateway"]
    depends_on:
      migrate: { condition: service_completed_successfully }

volumes:
  db-data: {}
  node-modules: {}
  next-cache: {}
```

`.env.example`:

```dotenv
DATABASE_URL=postgres://hearth:hearth@localhost:5432/hearth
BETTER_AUTH_SECRET=dev-only-secret-0123456789abcdef0123
BETTER_AUTH_URL=http://localhost:3000
APP_TIMEZONE=America/Bogota
LOG_LEVEL=info
```

Append to `README.md`:

```markdown
## Containerized development

Requires only Git and Docker.

    docker compose -f compose.dev.yaml up            # db -> deps -> migrate -> app on http://localhost:3000
    docker compose -f compose.dev.yaml run --rm app sh -c "corepack enable && pnpm test"   # tests; Testcontainers uses the mounted Docker socket

Hot reload: the source is bind-mounted. On a Windows host, file events from a Windows path do not reach the container, so polling is enabled (`WATCHPACK_POLLING`). If changes still do not reload with Turbopack, run the app with `pnpm dev --webpack --hostname 0.0.0.0`, or keep the repository inside WSL2 for native file events.
```

- [ ] **Step 11: Verify the dev stack end to end**

Run: `docker compose -f compose.dev.yaml up -d && docker compose -f compose.dev.yaml ps`
Expected: `db` healthy, `deps` and `migrate` exited 0, `app` running.

Run: `curl -s http://localhost:3000/api/v1/health`
Expected: `{"status":"ok"}`.

Edit `src/app/api/v1/health/route.ts` to return `{ status: "ok", reload: true }`, wait two seconds, curl again, expect the new body, then revert the edit.

Run: `docker compose -f compose.dev.yaml down`

- [ ] **Step 12: Commit**

```bash
git add .
git commit -m "feat(db): add Drizzle persistence, transactions, migrations and containerized dev stack (Refs #5, Refs #1)"
```

---

### Task 7: HTTP core — problem+json, request ids and `defineRoute`

Implements the error, auth-guard and request-id part of HU-E0-09 (issue #8).

**Files:**
- Create: `src/shared/kernel/auth-user.ts`; Modify: `src/shared/kernel/index.ts`
- Create: `src/shared/http/problem.ts`, `src/shared/http/request-id.ts`, `src/shared/http/session-resolver.ts`, `src/shared/http/logger.ts`, `src/shared/http/define-route.ts`, `src/shared/http/index.ts`
- Test: `src/shared/http/problem.test.ts`, `src/shared/http/define-route.test.ts`

**Interfaces:**
- Consumes: `Result`, `ok`, `err`, `domainError`, `TransactionManager` (Tasks 3, 6).
- Produces:
  - kernel `interface AuthUser { readonly id: string; readonly name: string; readonly email: string; readonly locale: string; readonly timezone: string }`
  - `statusForCode(code: string): number`; `problemResponse(code: string, requestId: string, errors?: ProblemFieldError[]): Response`; `interface ProblemFieldError { path: string; message: string }`
  - `requestIdFrom(request: Request): string`
  - `interface SessionResolver { resolve(headers: Headers): Promise<AuthUser | null> }`
  - `interface Logger { info(event: string, data?: Record<string, unknown>): void; error(event: string, data?: Record<string, unknown>): void }`; `jsonLogger: Logger`
  - `type HttpSuccess = { status: number; body?: unknown; headers?: ReadonlyArray<readonly [string, string]> }`
  - `interface RouteDeps { sessionResolver: SessionResolver; logger: Logger }`
  - `createRouteFactory(getDeps: () => RouteDeps)` → `defineRoute<B, Q, P>(spec: RouteSpec<B, Q, P>)` returning `(request: Request, context?: { params?: Promise<P> }) => Promise<Response>`
  - `interface RouteSpec<B, Q, P> { auth: "required" | "none"; body?: ZodType<B>; query?: ZodType<Q>; before?: (ctx: RouteContext<B, Q, P>, next: () => Promise<Result<HttpSuccess>>) => Promise<Result<HttpSuccess>>; handler: (ctx: RouteContext<B, Q, P>) => Promise<Result<HttpSuccess>> }`
  - `interface RouteContext<B, Q, P> { request: Request; requestId: string; user: AuthUser | null; body: B; query: Q; params: P }`

- [ ] **Step 1: Write the failing tests**

`src/shared/http/problem.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { problemResponse, statusForCode } from "./problem";

describe("statusForCode", () => {
  it.each([
    ["InsufficientRole", 403],
    ["InvalidAmount", 422],
    ["SpaceNotFound", 404],
    ["OutstandingBalance", 409],
    ["PeriodClosed", 409],
    ["Unauthenticated", 401],
    ["InvalidCredentials", 401],
    ["NotASpaceMember", 422],
    ["ValidationFailed", 422],
    ["PreconditionFailed", 412],
    ["InternalError", 500],
  ])("maps %s to %i", (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });
});

describe("problemResponse", () => {
  it("builds an RFC 9457 body with code and requestId", async () => {
    const response = problemResponse("SpaceNotFound", "req-1");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(await response.json()).toEqual({
      type: "urn:hearth:problem:SpaceNotFound",
      title: "Not Found",
      status: 404,
      code: "SpaceNotFound",
      requestId: "req-1",
    });
  });
});
```

`src/shared/http/define-route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import { createRouteFactory } from "./define-route";
import type { Logger } from "./logger";

const ana: AuthUser = { id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es", timezone: "America/Bogota" };
const logger: Logger = { info: vi.fn(), error: vi.fn() };
const defineRoute = createRouteFactory(() => ({
  sessionResolver: { resolve: async (h) => (h.get("authorization") === "Bearer ana" ? ana : null) },
  logger,
}));
const call = (handler: (r: Request) => Promise<Response>, init: RequestInit & { path?: string } = {}) =>
  handler(new Request(`http://localhost${init.path ?? "/api/v1/test"}`, init));

describe("defineRoute", () => {
  it.each([
    ["InsufficientRole", 403],
    ["InvalidAmount", 422],
    ["SpaceNotFound", 404],
    ["OutstandingBalance", 409],
    ["PeriodClosed", 409],
  ])("returns the domain error %s as problem+json %i with no translated text", async (code, status) => {
    const route = defineRoute({ auth: "required", handler: async () => err(domainError(code)) });
    const response = await call(route, { headers: { authorization: "Bearer ana", "accept-language": "es" } });
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(body.code).toBe(code);
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
    expect(JSON.stringify(body)).not.toMatch(/[áéíóúñ¿¡]|no encontrado|prohibido/i);
  });

  it("rejects unauthenticated requests with 401 Unauthenticated", async () => {
    const route = defineRoute({ auth: "required", handler: async () => ok({ status: 200, body: {} }) });
    const response = await call(route);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("Unauthenticated");
  });

  it("serves public routes without credentials", async () => {
    const route = defineRoute({ auth: "none", handler: async ({ user }) => ok({ status: 200, body: { user } }) });
    expect(await (await call(route)).json()).toEqual({ user: null });
  });

  it("echoes a valid incoming X-Request-Id and replaces an invalid one", async () => {
    const route = defineRoute({ auth: "none", handler: async () => ok({ status: 204 }) });
    expect((await call(route, { headers: { "x-request-id": "abc-123" } })).headers.get("x-request-id")).toBe("abc-123");
    const replaced = (await call(route, { headers: { "x-request-id": "bad id with spaces" } })).headers.get("x-request-id");
    expect(replaced).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns 422 ValidationFailed with paths for contract failures", async () => {
    const route = defineRoute({
      auth: "none",
      body: z.object({ amount: z.string() }),
      handler: async () => ok({ status: 201 }),
    });
    const response = await call(route, { method: "POST", body: JSON.stringify({ amount: 160000000 }) });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("ValidationFailed");
    expect(body.errors[0].path).toBe("amount");
  });

  it("returns 422 ValidationFailed for malformed JSON instead of a 500", async () => {
    const route = defineRoute({ auth: "none", body: z.object({}), handler: async () => ok({ status: 201 }) });
    const response = await call(route, { method: "POST", body: '{"amount": ' });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("ValidationFailed");
  });

  it("validates the query string", async () => {
    const route = defineRoute({
      auth: "none",
      query: z.object({ limit: z.coerce.number().int().max(200) }),
      handler: async ({ query }) => ok({ status: 200, body: query }),
    });
    expect((await call(route, { path: "/api/v1/test?limit=201" })).status).toBe(422);
    expect(await (await call(route, { path: "/api/v1/test?limit=5" })).json()).toEqual({ limit: 5 });
  });

  it("logs unexpected errors and returns 500 InternalError", async () => {
    const route = defineRoute({ auth: "none", handler: async () => { throw new Error("db down"); } });
    const response = await call(route);
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("InternalError");
    expect(logger.error).toHaveBeenCalledWith("unhandled_route_error", expect.objectContaining({ error: "Error: db down" }));
  });

  it("serializes bigint values as strings and appends repeated headers", async () => {
    const route = defineRoute({
      auth: "none",
      handler: async () => ok({ status: 200, body: { minor: 160000000n }, headers: [["set-cookie", "a=1"], ["set-cookie", "b=2"]] }),
    });
    const response = await call(route);
    expect(await response.json()).toEqual({ minor: "160000000" });
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("lets a before hook wrap the handler", async () => {
    const route = defineRoute({
      auth: "none",
      before: async (_ctx, next) => {
        const result = await next();
        return result.ok ? ok({ ...result.value, headers: [["x-wrapped", "yes"]] }) : result;
      },
      handler: async () => ok({ status: 200, body: {} }),
    });
    expect((await call(route)).headers.get("x-wrapped")).toBe("yes");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run --project unit src/shared/http`
Expected: FAIL — `Cannot find module './problem'` and `'./define-route'`.

- [ ] **Step 3: Implement the HTTP core**

`src/shared/kernel/auth-user.ts`:

```ts
export interface AuthUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly locale: string;
  readonly timezone: string;
}
```

Append to `src/shared/kernel/index.ts`:

```ts
export * from "./auth-user";
```

`src/shared/http/problem.ts`:

```ts
export interface ProblemFieldError {
  readonly path: string;
  readonly message: string;
}

const EXPLICIT: Readonly<Record<string, number>> = {
  Unauthenticated: 401,
  InvalidCredentials: 401,
  InsufficientRole: 403,
  ValidationFailed: 422,
  NotASpaceMember: 422,
  PasswordTooShort: 422,
  EmailTaken: 409,
  IdempotencyKeyConflict: 409,
  PreconditionFailed: 412,
  InternalError: 500,
};

const TITLES: Readonly<Record<number, string>> = {
  401: "Unauthenticated",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  412: "Precondition Failed",
  422: "Unprocessable Content",
  500: "Internal Server Error",
};

/** Spec section 8: explicit codes first, then naming conventions, then 409 for invariant violations. */
export const statusForCode = (code: string): number =>
  EXPLICIT[code] ?? (code.endsWith("NotFound") ? 404 : code.startsWith("Invalid") ? 422 : 409);

export const problemResponse = (code: string, requestId: string, errors?: ProblemFieldError[]): Response => {
  const status = statusForCode(code);
  const body = {
    type: `urn:hearth:problem:${code}`,
    title: TITLES[status] ?? "Error",
    status,
    code,
    requestId,
    ...(errors ? { errors } : {}),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": requestId },
  });
};
```

`src/shared/http/request-id.ts`:

```ts
const VALID = /^[A-Za-z0-9._-]{1,128}$/;

export const requestIdFrom = (request: Request): string => {
  const incoming = request.headers.get("x-request-id");
  return incoming && VALID.test(incoming) ? incoming : crypto.randomUUID();
};
```

`src/shared/http/session-resolver.ts`:

```ts
import type { AuthUser } from "@/shared/kernel";

/** Resolves the acting user from a session cookie or an `Authorization: Bearer` header. */
export interface SessionResolver {
  resolve(headers: Headers): Promise<AuthUser | null>;
}
```

`src/shared/http/logger.ts`:

```ts
export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

const write = (level: string, event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, event, time: new Date().toISOString(), ...data }));

export const jsonLogger: Logger = {
  info: (event, data) => write("info", event, data),
  error: (event, data) => write("error", event, data),
};
```

`src/shared/http/define-route.ts`:

```ts
import type { ZodType } from "zod";
import type { AuthUser, Result } from "@/shared/kernel";
import type { Logger } from "./logger";
import { problemResponse, type ProblemFieldError } from "./problem";
import { requestIdFrom } from "./request-id";
import type { SessionResolver } from "./session-resolver";

export type HttpSuccess = {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: ReadonlyArray<readonly [string, string]>;
};

export interface RouteDeps {
  readonly sessionResolver: SessionResolver;
  readonly logger: Logger;
}

export interface RouteContext<B, Q, P> {
  readonly request: Request;
  readonly requestId: string;
  readonly user: AuthUser | null;
  readonly body: B;
  readonly query: Q;
  readonly params: P;
}

export interface RouteSpec<B, Q, P> {
  readonly auth: "required" | "none";
  readonly body?: ZodType<B>;
  readonly query?: ZodType<Q>;
  /** Wraps the handler, e.g. idempotency (Task 9). */
  readonly before?: (ctx: RouteContext<B, Q, P>, next: () => Promise<Result<HttpSuccess>>) => Promise<Result<HttpSuccess>>;
  readonly handler: (ctx: RouteContext<B, Q, P>) => Promise<Result<HttpSuccess>>;
}

const toFieldErrors = (issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): ProblemFieldError[] =>
  issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));

const bigintAsString = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export const createRouteFactory =
  (getDeps: () => RouteDeps) =>
  <B = undefined, Q = undefined, P extends Record<string, string> = Record<string, string>>(spec: RouteSpec<B, Q, P>) =>
  async (request: Request, context?: { params?: Promise<P> }): Promise<Response> => {
    const requestId = requestIdFrom(request);
    const deps = getDeps();
    try {
      const user = spec.auth === "none" ? null : await deps.sessionResolver.resolve(request.headers);
      if (spec.auth === "required" && !user) return problemResponse("Unauthenticated", requestId);

      let query = undefined as Q;
      if (spec.query) {
        const parsed = spec.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!parsed.success) return problemResponse("ValidationFailed", requestId, toFieldErrors(parsed.error.issues));
        query = parsed.data;
      }

      let body = undefined as B;
      if (spec.body) {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return problemResponse("ValidationFailed", requestId, [{ path: "", message: "Body must be valid JSON" }]);
        }
        const parsed = spec.body.safeParse(raw);
        if (!parsed.success) return problemResponse("ValidationFailed", requestId, toFieldErrors(parsed.error.issues));
        body = parsed.data;
      }

      const params = ((await context?.params) ?? {}) as P;
      const ctx: RouteContext<B, Q, P> = { request, requestId, user, body, query, params };
      const result = spec.before ? await spec.before(ctx, () => spec.handler(ctx)) : await spec.handler(ctx);
      if (!result.ok) return problemResponse(result.error.code, requestId);

      const headers = new Headers({ "x-request-id": requestId });
      for (const [name, value] of result.value.headers ?? []) headers.append(name, value);
      if (result.value.body === undefined) return new Response(null, { status: result.value.status, headers });
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(result.value.body, bigintAsString), { status: result.value.status, headers });
    } catch (error) {
      deps.logger.error("unhandled_route_error", { requestId, error: String(error) });
      return problemResponse("InternalError", requestId);
    }
  };
```

`src/shared/http/index.ts`:

```ts
export * from "./define-route";
export * from "./logger";
export * from "./problem";
export * from "./request-id";
export * from "./session-resolver";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/shared/http`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Gates and commit**

Run: `pnpm lint:boundaries && pnpm typecheck`
Expected: both exit 0.

```bash
git add src/shared
git commit -m "feat(http): add problem+json mapping, request ids and defineRoute (Refs #8)"
```

---

### Task 8: OpenAPI contract, health and `GET /api/v1/me`

Completes HU-E0-09 (issue #8).

**Files:**
- Create: `src/shared/http/contracts.ts` (MoneySchema, ProblemSchema, money mappers)
- Create: `src/shared/http/system.contract.ts` (health + openapi operations)
- Create: `src/modules/identity/contracts/me.contract.ts`
- Create: `src/composition/container.ts`, `src/composition/route.ts`, `src/composition/openapi.ts`
- Create: `src/app/api/v1/openapi.json/route.ts`, `src/app/api/v1/me/route.ts`; Modify: `src/app/api/v1/health/route.ts`
- Create: `openapi/openapi.snapshot.json` (generated), `docs/adr/0002-openapi-generator-zod-openapi.md`
- Test: `src/shared/http/contracts.test.ts`, `src/composition/openapi.test.ts`, `src/app/api/v1/routes.test.ts`

**Interfaces:**
- Consumes: `createRouteFactory`, `RouteDeps`, `SessionResolver`, `jsonLogger`, `problemResponse` (Task 7); `Money` (Task 4); `AuthUser` (Task 7).
- Produces:
  - `MoneySchema` (`{ amount: string /^-?\d{1,19}$/ within bigint range, currency: /^[A-Z]{3}$/ }`), `ProblemSchema`, `moneyToDto(money: Money): MoneyDto`, `moneyFromDto(dto: MoneyDto): Result<Money>`
  - `MeResponseSchema`, `mePaths`, `healthPaths`, `openApiPaths`
  - `interface Container extends RouteDeps { … }` (grown in Tasks 10–11); `getContainer(): Container`; `setContainerForTests(container: Container | undefined): void`
  - `defineRoute` bound to the container (from `@/composition/route`)
  - `buildOpenApiDocument(): Record<string, unknown>` and `changedOperations(before, after): string[]`

- [ ] **Step 1: Install the OpenAPI generator**

```bash
pnpm add -E zod-openapi@6.0.2
```

- [ ] **Step 2: Write the failing contract tests**

`src/shared/http/contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel";
import { MoneySchema, moneyFromDto, moneyToDto } from "./contracts";

describe("MoneySchema", () => {
  it("serializes Money as a minor-units string", () => {
    const money = Money.fromMajor("1600000", "COP");
    if (!money.ok) throw new Error(money.error.code);
    expect(moneyToDto(money.value)).toEqual({ amount: "160000000", currency: "COP" });
  });

  it("parses a valid DTO back into Money", () => {
    const parsed = moneyFromDto({ amount: "160000000", currency: "COP" });
    expect(parsed.ok && parsed.value.minor).toBe(160000000n);
  });

  it.each([
    [{ amount: 160000000, currency: "COP" }, "amount"],
    [{ amount: "+5", currency: "COP" }, "amount"],
    [{ amount: " 5", currency: "COP" }, "amount"],
    [{ amount: "5.00", currency: "COP" }, "amount"],
    [{ amount: "9223372036854775808", currency: "COP" }, "amount"],
    [{ amount: "5", currency: "cop" }, "currency"],
  ])("rejects %j at path %s", (input, path) => {
    const result = MoneySchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.path).toEqual([path]);
  });

  it("accepts the PostgreSQL bigint bounds", () => {
    expect(MoneySchema.safeParse({ amount: "9223372036854775807", currency: "COP" }).success).toBe(true);
    expect(MoneySchema.safeParse({ amount: "-9223372036854775808", currency: "COP" }).success).toBe(true);
  });
});
```

Run: `pnpm vitest run --project unit src/shared/http/contracts.test.ts`
Expected: FAIL — `Cannot find module './contracts'`.

- [ ] **Step 3: Implement the shared contracts**

`src/shared/http/contracts.ts`:

```ts
import { z } from "zod";
import { Money, type Result } from "@/shared/kernel";

const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;

export const MoneySchema = z.object({
  amount: z
    .string()
    .regex(/^-?\d{1,19}$/, { error: "Amount must be an integer string in minor units" })
    .refine((value) => BigInt(value) >= BIGINT_MIN && BigInt(value) <= BIGINT_MAX, {
      error: "Amount is outside the supported range",
    }),
  currency: z.string().regex(/^[A-Z]{3}$/, { error: "Currency must be an ISO 4217 code" }),
});
export type MoneyDto = z.infer<typeof MoneySchema>;

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  requestId: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export const moneyToDto = (money: Money): MoneyDto => ({ amount: money.minor.toString(), currency: money.currency.code });
export const moneyFromDto = (dto: MoneyDto): Result<Money> => Money.ofMinor(BigInt(dto.amount), dto.currency);

/** Standard error responses for operations; every protected operation lists 401. */
export const problemContent = { "application/problem+json": { schema: ProblemSchema } } as const;
```

Run: `pnpm vitest run --project unit src/shared/http/contracts.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing OpenAPI and route tests**

`src/composition/openapi.test.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, changedOperations } from "./openapi";

const SNAPSHOT = "openapi/openapi.snapshot.json";

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument() as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown> };
  };

  it("is OpenAPI 3.1.0 with the foundation operations and shared schemas", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/v1/health"]?.get).toBeDefined();
    expect(doc.paths["/api/v1/me"]?.get).toBeDefined();
    expect(doc.components.schemas.Money).toBeDefined();
    expect(doc.components.schemas.Problem).toBeDefined();
  });

  it("matches the committed snapshot operation by operation", () => {
    if (process.env.UPDATE_OPENAPI_SNAPSHOT === "1") {
      writeFileSync(SNAPSHOT, `${JSON.stringify(doc, null, 2)}\n`);
      return;
    }
    const committed = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    expect(changedOperations(committed, doc)).toEqual([]);
    expect(doc.components).toEqual(committed.components);
  });

  it("names the operations that changed", () => {
    const before = { paths: { "/api/v1/me": { get: { summary: "a" } }, "/x": { post: {} } } };
    const after = { paths: { "/api/v1/me": { get: { summary: "b" } }, "/x": { post: {} }, "/y": { get: {} } } };
    expect(changedOperations(before, after)).toEqual(["GET /api/v1/me", "GET /y"]);
  });
});
```

`src/app/api/v1/routes.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { jsonLogger } from "@/shared/http";
import type { AuthUser } from "@/shared/kernel";
import { setContainerForTests, type Container } from "@/composition/container";
import { GET as health } from "./health/route";
import { GET as me } from "./me/route";
import { GET as openapi } from "./openapi.json/route";

const ana: AuthUser = { id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es", timezone: "America/Bogota" };
const use = (resolve: (h: Headers) => Promise<AuthUser | null>) =>
  setContainerForTests({ sessionResolver: { resolve }, logger: jsonLogger } as Container);
const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://localhost${path}`, { headers });

afterEach(() => setContainerForTests(undefined));

describe("foundation routes", () => {
  it("serves the OpenAPI document without credentials", async () => {
    use(async () => null);
    const response = await openapi(get("/api/v1/openapi.json"));
    expect(response.status).toBe(200);
    expect((await response.json()).openapi).toBe("3.1.0");
  });

  it("serves health without credentials", async () => {
    use(async () => null);
    const response = await health(get("/api/v1/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("rejects GET /me without credentials", async () => {
    use(async () => null);
    const response = await me(get("/api/v1/me"));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("Unauthenticated");
  });

  it("returns the acting user from GET /me", async () => {
    use(async (h) => (h.get("authorization") === "Bearer t" ? ana : null));
    const response = await me(get("/api/v1/me", { authorization: "Bearer t" }));
    expect(await response.json()).toEqual(ana);
  });
});
```

Run: `pnpm vitest run --project unit src/composition src/app`
Expected: FAIL — modules `./openapi`, `@/composition/container`, `./me/route`, `./openapi.json/route` not found.

- [ ] **Step 5: Implement contracts, composition and routes**

`src/shared/http/system.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";

export const HealthResponseSchema = z.object({ status: z.literal("ok") });

export const healthPaths: ZodOpenApiPathsObject = {
  "/api/v1/health": {
    get: {
      operationId: "getHealth",
      summary: "Liveness check",
      responses: { "200": { description: "The process is up", content: { "application/json": { schema: HealthResponseSchema } } } },
    },
  },
};

export const openApiPaths: ZodOpenApiPathsObject = {
  "/api/v1/openapi.json": {
    get: {
      operationId: "getOpenApiDocument",
      summary: "OpenAPI 3.1 document of this API",
      responses: { "200": { description: "The OpenAPI document" } },
    },
  },
};
```

`src/modules/identity/contracts/me.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  locale: z.string(),
  timezone: z.string(),
});

export const mePaths: ZodOpenApiPathsObject = {
  "/api/v1/me": {
    get: {
      operationId: "getMe",
      summary: "The authenticated user",
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      responses: {
        "200": { description: "Current user", content: { "application/json": { schema: MeResponseSchema } } },
        "401": { description: "Not authenticated", content: problemContent },
      },
    },
  },
};
```

`src/composition/container.ts`:

```ts
import { jsonLogger, type RouteDeps } from "@/shared/http";

/** Process-wide dependencies. Task 10 turns this into an interface with auth, database and use cases. */
export type Container = RouteDeps;

const buildContainer = (): Container => ({
  // Replaced by the Better Auth resolver in Task 10.
  sessionResolver: { resolve: async () => null },
  logger: jsonLogger,
});

let container: Container | undefined;

export const getContainer = (): Container => (container ??= buildContainer());

export const setContainerForTests = (next: Container | undefined): void => {
  container = next;
};
```

`src/composition/route.ts`:

```ts
import { createRouteFactory } from "@/shared/http";
import { getContainer } from "./container";

export const defineRoute = createRouteFactory(getContainer);
```

`src/composition/openapi.ts`:

```ts
import { createDocument, type ZodOpenApiObject } from "zod-openapi";
import { mePaths } from "@/modules/identity/contracts/me.contract";
import { MoneySchema, ProblemSchema } from "@/shared/http/contracts";
import { healthPaths, openApiPaths } from "@/shared/http/system.contract";

export const buildOpenApiDocument = (): Record<string, unknown> =>
  createDocument({
    openapi: "3.1.0" as ZodOpenApiObject["openapi"],
    info: { title: "Hearth API", version: "1.0.0" },
    paths: { ...healthPaths, ...openApiPaths, ...mePaths },
    components: {
      schemas: { Money: MoneySchema, Problem: ProblemSchema },
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "hearth.session_token" },
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  }) as unknown as Record<string, unknown>;

type Paths = Record<string, Record<string, unknown>>;

/** Lists "METHOD /path" for every operation added, removed or changed between two documents. */
export const changedOperations = (before: { paths?: Paths }, after: { paths?: Paths }): string[] => {
  const keys = (doc: { paths?: Paths }) =>
    Object.entries(doc.paths ?? {}).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m} ${path}`));
  const all = [...new Set([...keys(before), ...keys(after)])];
  return all
    .filter((key) => {
      const [method, path] = key.split(" ") as [string, string];
      return JSON.stringify(before.paths?.[path]?.[method]) !== JSON.stringify(after.paths?.[path]?.[method]);
    })
    .map((key) => {
      const [method, path] = key.split(" ") as [string, string];
      return `${method.toUpperCase()} ${path}`;
    })
    .sort();
};
```

`src/app/api/v1/health/route.ts` (replace):

```ts
import { ok } from "@/shared/kernel";
import { defineRoute } from "@/composition/route";

export const runtime = "nodejs";

export const GET = defineRoute({ auth: "none", handler: async () => ok({ status: 200, body: { status: "ok" } }) });
```

`src/app/api/v1/openapi.json/route.ts`:

```ts
import { ok } from "@/shared/kernel";
import { buildOpenApiDocument } from "@/composition/openapi";
import { defineRoute } from "@/composition/route";

export const runtime = "nodejs";

export const GET = defineRoute({ auth: "none", handler: async () => ok({ status: 200, body: buildOpenApiDocument() }) });
```

`src/app/api/v1/me/route.ts`:

```ts
import { ok } from "@/shared/kernel";
import { defineRoute } from "@/composition/route";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => ok({ status: 200, body: user }),
});
```

- [ ] **Step 6: Generate the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm vitest run --project unit src/composition/openapi.test.ts`
(PowerShell: `$env:UPDATE_OPENAPI_SNAPSHOT=1; pnpm vitest run --project unit src/composition/openapi.test.ts; Remove-Item Env:UPDATE_OPENAPI_SNAPSHOT`)
Expected: writes `openapi/openapi.snapshot.json`; open it and confirm `"openapi": "3.1.0"`, both paths and `components.schemas.Money`/`Problem`.

Run: `pnpm vitest run --project unit src/shared/http src/composition src/app`
Expected: PASS.

Manual red check for the contract gate: change `MeResponseSchema`'s `locale` to `z.string().min(2)`, run `pnpm vitest run --project unit src/composition/openapi.test.ts`, expect a failure whose diff lists `"GET /api/v1/me"`, then revert.

Run: `pnpm typecheck && pnpm lint:boundaries`
Expected: exit 0. (If TypeScript rejects the `openapi` literal despite the cast, keep the cast and add `// zod-openapi 6 types target OAS 3.2; we emit 3.1.0 by design` above it — the runtime value is what the test checks.)

- [ ] **Step 7: Record the generator decision and commit**

`docs/adr/0002-openapi-generator-zod-openapi.md`:

```markdown
# ADR 0002 — Generate OpenAPI 3.1 with zod-openapi

- Status: Accepted (2026-10-11)
- Story: HU-E0-09

## Context

Contracts are Zod 4 schemas per module. Candidates: zod-openapi 6.0.2 and @asteasolutions/zod-to-openapi 9.1.0.

## Decision

Use zod-openapi 6.0.2. It builds on Zod 4's native metadata without patching Zod's prototype, and documents are plain objects composed from per-module path fragments.

## Consequences

- Each module exports `ZodOpenApiPathsObject` fragments from `contracts/`; `src/composition/openapi.ts` merges them.
- zod-openapi 6 types target OAS 3.2; we emit `openapi: "3.1.0"` with a cast. Revisit when clients support 3.2.
- `openapi/openapi.snapshot.json` is the reviewed contract; CI fails on unintended changes and names each changed operation.
```

```bash
git add .
git commit -m "feat(api): add OpenAPI contract, health and current-user endpoints (Refs #8)"
```

---

### Task 9: Idempotency, cursor pagination and optimistic concurrency

Implements HU-E0-10 (issue #9).

**Files:**
- Create: `src/shared/http/json.ts`, `src/shared/http/idempotency.ts`, `src/shared/http/pagination.ts`, `src/shared/http/etag.ts`; Modify: `src/shared/http/index.ts`, `src/shared/http/define-route.ts` (use `toJsonSafe`)
- Create: `src/shared/infrastructure/drizzle-idempotency-store.ts`
- Test: `src/shared/http/pagination.test.ts`, `src/shared/infrastructure/http-safety.int.test.ts`

**Interfaces:**
- Consumes: `defineRoute`/`createRouteFactory`, `RouteContext`, `HttpSuccess` (Task 7); `MoneySchema` (Task 8); `DrizzleTransactionManager`, `idempotencyKeys`, `testDatabase` (Task 6).
- Produces:
  - `toJsonSafe(value: unknown): unknown` (bigints → strings)
  - `interface IdempotencyScope { userId: string; route: string; key: string }`; `interface IdempotencyStore { claim(scope, requestHash: string): Promise<{ requestHash: string; response: HttpSuccess | null } | null>; complete(scope, requestHash: string, response: HttpSuccess): Promise<void> }`; `interface IdempotencyDeps { store: IdempotencyStore; tm: TransactionManager }`; `idempotent(deps: IdempotencyDeps)` — a `before` hook for `defineRoute`
  - `PaginationQuerySchema` (`cursor?`, `limit` 1–200, default 50); `interface Cursor { sortKey: string; id: string }`; `encodeCursor(c): string`; `decodeCursor(raw): Result<Cursor>` (`InvalidCursor`); `toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor): { items: T[]; nextCursor: string | null }`
  - `etagOf(version: number): string`; `ifMatchVersion(request: Request): Result<number | null>` (`PreconditionFailed` on a malformed header)
  - `class DrizzleIdempotencyStore implements IdempotencyStore`
  - Repositories implement optimistic updates as `UPDATE … SET …, version = version + 1 WHERE id = $id AND version = $expected` and return `PreconditionFailed` when no row matches.

- [ ] **Step 1: Write the failing pagination unit test**

`src/shared/http/pagination.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PaginationQuerySchema, decodeCursor, encodeCursor, toPage } from "./pagination";

describe("pagination", () => {
  it("defaults to 50 and caps at 200", () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(PaginationQuerySchema.parse({ limit: "200" }).limit).toBe(200);
    expect(PaginationQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("round-trips an opaque cursor", () => {
    const cursor = { sortKey: "2026-11-01", id: "a1" };
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded).toEqual({ ok: true, value: cursor });
  });

  it.each(["not-base64!!", Buffer.from("{}").toString("base64url"), Buffer.from('["a"]').toString("base64url")])(
    "rejects the tampered cursor %s",
    (raw) => {
      const decoded = decodeCursor(raw);
      expect(!decoded.ok && decoded.error.code).toBe("InvalidCursor");
    },
  );

  it("builds a page and the next cursor from limit + 1 rows", () => {
    const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const page = toPage(rows, 2, (r) => ({ sortKey: r.id, id: r.id }));
    expect(page.items).toEqual([{ id: "1" }, { id: "2" }]);
    expect(page.nextCursor).toBe(encodeCursor({ sortKey: "2", id: "2" }));
    expect(toPage(rows, 3, (r) => ({ sortKey: r.id, id: r.id })).nextCursor).toBeNull();
  });
});
```

Run: `pnpm vitest run --project unit src/shared/http/pagination.test.ts`
Expected: FAIL — `Cannot find module './pagination'`.

- [ ] **Step 2: Implement pagination, ETags and JSON safety**

`src/shared/http/json.ts`:

```ts
/** Deep copy that turns bigints into strings so values can be stored as JSON or sent over HTTP. */
export const toJsonSafe = (value: unknown): unknown =>
  value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
```

In `src/shared/http/define-route.ts`, delete the `bigintAsString` helper and replace the final serialization line with:

```ts
      return new Response(JSON.stringify(toJsonSafe(result.value.body)), { status: result.value.status, headers });
```

and add `import { toJsonSafe } from "./json";`.

`src/shared/http/pagination.ts`:

```ts
import { z } from "zod";
import { domainError, err, ok, type Result } from "@/shared/kernel";

export const PaginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface Cursor {
  readonly sortKey: string;
  readonly id: string;
}

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify([cursor.sortKey, cursor.id]), "utf8").toString("base64url");

export const decodeCursor = (raw: string): Result<Cursor> => {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string") {
      return ok({ sortKey: value[0], id: value[1] });
    }
  } catch {
    // fall through
  }
  return err(domainError("InvalidCursor"));
};

/** `rows` must hold up to `limit + 1` items, ordered by (sortKey, id). */
export const toPage = <T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor) => {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
};
```

`src/shared/http/etag.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";

export const etagOf = (version: number): string => `"${version}"`;

/** Reads `If-Match: "<version>"`; absent → null, malformed → PreconditionFailed. */
export const ifMatchVersion = (request: Request): Result<number | null> => {
  const header = request.headers.get("if-match");
  if (header === null) return ok(null);
  const match = /^"(\d+)"$/.exec(header.trim());
  return match ? ok(Number(match[1])) : err(domainError("PreconditionFailed"));
};
```

Run: `pnpm vitest run --project unit src/shared/http`
Expected: PASS (pagination plus the Task 7 tests still green).

- [ ] **Step 3: Write the failing integration test with test-only routes**

`src/shared/infrastructure/http-safety.int.test.ts`:

```ts
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { bigint, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MoneySchema } from "@/shared/http/contracts";
import { createRouteFactory, jsonLogger } from "@/shared/http";
import { etagOf, ifMatchVersion } from "@/shared/http/etag";
import { idempotent } from "@/shared/http/idempotency";
import { PaginationQuerySchema, decodeCursor, toPage } from "@/shared/http/pagination";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import { testDatabase } from "../../../tests/support/database";
import { DrizzleTransactionManager } from "./db/drizzle-transaction-manager";
import { DrizzleIdempotencyStore } from "./drizzle-idempotency-store";

const probe = pgTable("http_probe", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  version: integer("version").notNull().default(1),
});
const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const ana: AuthUser = { id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es", timezone: "America/Bogota" };
const defineRoute = createRouteFactory(() => ({ sessionResolver: { resolve: async () => ana }, logger: jsonLogger }));

const create = defineRoute({
  auth: "required",
  body: z.object({ amount: MoneySchema }),
  before: idempotent({ tm, store: new DrizzleIdempotencyStore(tm) }),
  handler: async ({ body, user }) =>
    tm.run(async () => {
      const [row] = await tm.executor().insert(probe).values({ userId: user!.id, amount: BigInt(body.amount.amount) }).returning();
      return ok({ status: 201, body: { id: row!.id, amount: body.amount } });
    }),
});

const list = defineRoute({
  auth: "required",
  query: PaginationQuerySchema,
  handler: async ({ query }) => {
    const cursor = query.cursor ? decodeCursor(query.cursor) : ok(null);
    if (!cursor.ok) return cursor;
    const rows = await db
      .select({ id: probe.id })
      .from(probe)
      .where(cursor.value ? gt(probe.id, cursor.value.id) : undefined)
      .orderBy(asc(probe.id))
      .limit(query.limit + 1);
    return ok({ status: 200, body: toPage(rows, query.limit, (r) => ({ sortKey: r.id, id: r.id })) });
  },
});

const update = defineRoute({
  auth: "required",
  body: z.object({ amount: MoneySchema }),
  handler: async ({ request, body, params }) => {
    const expected = ifMatchVersion(request);
    if (!expected.ok) return expected;
    const [row] = await db
      .update(probe)
      .set({ amount: BigInt(body.amount.amount), version: sql`${probe.version} + 1` })
      .where(and(eq(probe.id, params.id!), expected.value === null ? undefined : eq(probe.version, expected.value)))
      .returning();
    if (!row) return err(domainError("PreconditionFailed"));
    return ok({ status: 200, body: { id: row.id }, headers: [["etag", etagOf(row.version)]] });
  },
});

const post = (key: string, major: string) =>
  create(new Request("http://localhost/api/v1/probe", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify({ amount: { amount: `${major}00`, currency: "COP" } }),
  }));
const rowsCount = async () => (await db.select({ n: count() }).from(probe))[0]!.n;
const seed = (n: number) =>
  db.execute(sql`INSERT INTO http_probe (user_id, amount) SELECT 'u-ana', 100 FROM generate_series(1, ${n})`);

beforeAll(async () => {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS http_probe (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, amount bigint NOT NULL, version integer NOT NULL DEFAULT 1)`);
});
beforeEach(() => db.execute(sql`TRUNCATE http_probe; TRUNCATE idempotency_keys`));
afterAll(() => pool.end());

describe("idempotency", () => {
  it("returns the original response for a replayed request", async () => {
    const first = await post("7f3c9a1e", "85000");
    const second = await post("7f3c9a1e", "85000");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(await rowsCount()).toBe(1);
  });

  it("rejects reusing a key with a different payload", async () => {
    await post("7f3c9a1e", "85000");
    const response = await post("7f3c9a1e", "95000");
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("IdempotencyKeyConflict");
    expect(await rowsCount()).toBe(1);
  });

  it("creates exactly one record when duplicates arrive concurrently", async () => {
    const [a, b] = await Promise.all([post("concurrent-1", "85000"), post("concurrent-1", "85000")]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await a.json()).toEqual(await b.json());
    expect(await rowsCount()).toBe(1);
  });

  it("ignores requests without a key", async () => {
    await create(new Request("http://localhost/api/v1/probe", { method: "POST", body: JSON.stringify({ amount: { amount: "100", currency: "COP" } }) }));
    await create(new Request("http://localhost/api/v1/probe", { method: "POST", body: JSON.stringify({ amount: { amount: "100", currency: "COP" } }) }));
    expect(await rowsCount()).toBe(2);
  });
});

describe("cursor pagination", () => {
  const page = (query: string) => list(new Request(`http://localhost/api/v1/probe${query}`));

  it.each([
    ["", 200, 50],
    ["?limit=200", 200, 200],
    ["?limit=201", 422, 0],
  ])("enforces limits for %s", async (query, status, items) => {
    await seed(250);
    const response = await page(query);
    expect(response.status).toBe(status);
    if (status === 200) expect((await response.json()).items).toHaveLength(items);
  });

  it("visits every record once when following nextCursor", async () => {
    await seed(120);
    const sizes: number[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const body: { items: { id: string }[]; nextCursor: string | null } = await (
        await page(cursor ? `?cursor=${cursor}` : "")
      ).json();
      sizes.push(body.items.length);
      body.items.forEach((item) => seen.add(item.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen.size).toBe(120);
  });

  it("returns 422 InvalidCursor for a tampered cursor", async () => {
    const response = await page("?cursor=garbage!!");
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("InvalidCursor");
  });
});

describe("optimistic concurrency", () => {
  const patch = (id: string, ifMatch: string) =>
    update(
      new Request(`http://localhost/api/v1/probe/${id}`, {
        method: "PATCH",
        headers: { "if-match": ifMatch },
        body: JSON.stringify({ amount: { amount: "500", currency: "COP" } }),
      }),
      { params: Promise.resolve({ id }) },
    );

  it("accepts a matching If-Match and returns the next ETag", async () => {
    const [row] = await db.insert(probe).values({ userId: "u-ana", amount: 100n, version: 3 }).returning();
    const response = await patch(row!.id, '"3"');
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"4"');
  });

  it("rejects a stale If-Match with 412 and leaves the row unchanged", async () => {
    const [row] = await db.insert(probe).values({ userId: "u-ana", amount: 100n, version: 4 }).returning();
    const response = await patch(row!.id, '"3"');
    expect(response.status).toBe(412);
    expect((await response.json()).code).toBe("PreconditionFailed");
    const [after] = await db.select().from(probe).where(eq(probe.id, row!.id));
    expect(after!.amount).toBe(100n);
    expect(after!.version).toBe(4);
  });
});
```

Run: `pnpm vitest run --project integration src/shared/infrastructure/http-safety.int.test.ts`
Expected: FAIL — `Cannot find module '@/shared/http/idempotency'` and `'./drizzle-idempotency-store'`.

- [ ] **Step 4: Implement idempotency**

`src/shared/http/idempotency.ts`:

```ts
import { createHash } from "node:crypto";
import { domainError, err, ok, type Result, type TransactionManager } from "@/shared/kernel";
import type { HttpSuccess, RouteContext } from "./define-route";
import { toJsonSafe } from "./json";

export interface IdempotencyScope {
  readonly userId: string;
  readonly route: string;
  readonly key: string;
}

export interface IdempotencyStore {
  /**
   * Claims (userId, route, key) inside the current transaction. Returns null when this call
   * created the claim; otherwise waits for any in-flight holder and returns its record.
   */
  claim(scope: IdempotencyScope, requestHash: string): Promise<{ requestHash: string; response: HttpSuccess | null } | null>;
  complete(scope: IdempotencyScope, requestHash: string, response: HttpSuccess): Promise<void>;
}

export interface IdempotencyDeps {
  readonly store: IdempotencyStore;
  readonly tm: TransactionManager;
}

const KEY = /^[A-Za-z0-9_-]{1,255}$/;

const hashOf = (route: string, body: unknown): string =>
  createHash("sha256").update(`${route}\n${JSON.stringify(toJsonSafe(body) ?? null)}`).digest("hex");

/** `before` hook for `defineRoute` on POSTs that create money records (spec section 7). */
export const idempotent =
  (deps: IdempotencyDeps) =>
  async <B, Q, P>(ctx: RouteContext<B, Q, P>, next: () => Promise<Result<HttpSuccess>>): Promise<Result<HttpSuccess>> => {
    const key = ctx.request.headers.get("idempotency-key");
    if (key === null || ctx.user === null) return next();
    if (!KEY.test(key)) return err(domainError("InvalidIdempotencyKey"));

    const scope = { userId: ctx.user.id, route: `${ctx.request.method} ${new URL(ctx.request.url).pathname}`, key };
    const requestHash = hashOf(scope.route, ctx.body);
    return deps.tm.run(async () => {
      const existing = await deps.store.claim(scope, requestHash);
      if (existing) {
        if (existing.requestHash !== requestHash || existing.response === null) return err(domainError("IdempotencyKeyConflict"));
        return ok(existing.response);
      }
      const result = await next();
      if (result.ok) await deps.store.complete(scope, requestHash, result.value);
      return result;
    });
  };
```

`src/shared/infrastructure/drizzle-idempotency-store.ts`:

```ts
import { and, eq, lt, sql } from "drizzle-orm";
import { toJsonSafe } from "@/shared/http/json";
import type { HttpSuccess } from "@/shared/http/define-route";
import type { IdempotencyScope, IdempotencyStore } from "@/shared/http/idempotency";
import type { DrizzleTransactionManager } from "./db/drizzle-transaction-manager";
import { idempotencyKeys } from "./idempotency.schema";

const byScope = (s: IdempotencyScope) =>
  and(eq(idempotencyKeys.userId, s.userId), eq(idempotencyKeys.route, s.route), eq(idempotencyKeys.key, s.key));

export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async claim(scope: IdempotencyScope, requestHash: string) {
    const db = this.tm.executor();
    await db.delete(idempotencyKeys).where(and(byScope(scope), lt(idempotencyKeys.createdAt, sql`now() - interval '24 hours'`)));
    // A concurrent uncommitted claim makes this INSERT wait until that transaction ends.
    const inserted = await db
      .insert(idempotencyKeys)
      .values({ ...scope, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (inserted.length > 0) return null;
    const [row] = await db.select().from(idempotencyKeys).where(byScope(scope)).for("update");
    if (!row) return null;
    return {
      requestHash: row.requestHash,
      response:
        row.responseStatus === null
          ? null
          : { status: row.responseStatus, body: row.responseBody ?? undefined, headers: row.responseHeaders ?? [] },
    };
  }

  async complete(scope: IdempotencyScope, requestHash: string, response: HttpSuccess): Promise<void> {
    const values = {
      responseStatus: response.status,
      responseBody: toJsonSafe(response.body) ?? null,
      responseHeaders: (response.headers ?? []).map(([k, v]) => [k, v] as [string, string]),
    };
    await this.tm
      .executor()
      .insert(idempotencyKeys)
      .values({ ...scope, requestHash, ...values })
      .onConflictDoUpdate({ target: [idempotencyKeys.userId, idempotencyKeys.route, idempotencyKeys.key], set: values });
  }
}
```

Append to `src/shared/http/index.ts`:

```ts
export * from "./etag";
export * from "./idempotency";
export * from "./json";
export * from "./pagination";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project integration src/shared/infrastructure/http-safety.int.test.ts`
Expected: PASS (11 tests).

Run: `pnpm test:unit && pnpm lint:boundaries && pnpm typecheck`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared
git commit -m "feat(http): add idempotency keys, cursor pagination and ETag concurrency (Refs #9)"
```

---

### Task 10: Email/password authentication with Better Auth

Implements HU-E1-01 (issue #10).

**Files:**
- Create: `src/modules/identity/infrastructure/auth.schema.ts`, `src/modules/identity/infrastructure/better-auth.ts`, `src/modules/identity/infrastructure/better-auth-provider.ts`
- Create: `src/modules/identity/application/auth-provider.ts`, `src/modules/identity/application/sign-up.ts`, `src/modules/identity/application/sign-in.ts`, `src/modules/identity/application/sign-out.ts`, `src/modules/identity/application/index.ts`
- Create: `src/modules/identity/contracts/auth.contract.ts`
- Create: `src/app/api/v1/auth/sign-up/route.ts`, `src/app/api/v1/auth/sign-in/route.ts`, `src/app/api/v1/auth/sign-out/route.ts`
- Modify: `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`
- Create: `drizzle/0001_auth.sql` (generated)
- Create: `tests/support/app.ts`
- Test: `src/modules/identity/application/sign-up.test.ts`, `tests/acceptance/auth.test.ts`

**Interfaces:**
- Consumes: `AuthUser`, `Result`, `domainError` (kernel); `SessionResolver`, `defineRoute`, `HttpSuccess`, `problemContent` (Tasks 7–8); `createDatabase`, `DrizzleTransactionManager`, `loadEnv`, `Env` (Task 6); `DrizzleIdempotencyStore`, `IdempotencyDeps` (Task 9); `MeResponseSchema` (Task 8).
- Produces:
  - `interface AuthSession { user: AuthUser; token: string | null; cookies: readonly string[] }`
  - `interface AuthProvider { signUp(input: { name: string; email: string; password: string }): Promise<Result<AuthSession>>; signIn(input: { email: string; password: string }): Promise<Result<AuthSession>>; signOut(credentials: { cookie?: string; authorization?: string }): Promise<Result<{ cookies: readonly string[] }>>; deleteUser(userId: string): Promise<void> }`
  - `normalizeEmail(email: string): string`
  - `createSignUp(deps: { auth: AuthProvider; provisionUser: (user: AuthUser) => Promise<Result<void>> })` → `SignUp = (input) => Promise<Result<AuthSession>>`
  - `createSignIn(auth: AuthProvider)` → `SignIn`; `createSignOut(auth: AuthProvider)` → `SignOut`
  - `class BetterAuthProvider implements AuthProvider, SessionResolver`
  - `buildContainer(env: Env, options?: { provisionUser?: (user: AuthUser) => Promise<Result<void>> }): Container`; `interface Container extends RouteDeps { db; pool; tm; idempotency: IdempotencyDeps; identity: { signUp; signIn; signOut } }`
  - error codes `EmailTaken` 409, `PasswordTooShort` 422, `InvalidEmail` 422, `InvalidCredentials` 401
  - test helpers `startTestApp(options?)`, `apiRequest(method, path, init?)`, `cookieHeader(response)`, `uniqueEmail(name)`

- [ ] **Step 1: Install Better Auth and write the auth schema**

```bash
pnpm add -E better-auth@1.7.7
```

`src/modules/identity/infrastructure/auth.schema.ts` (property names are the field names Better Auth expects; column names are snake_case):

```ts
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  locale: text("locale").notNull().default("es"),
  timezone: text("timezone").notNull().default("America/Bogota"),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: tz("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: tz("access_token_expires_at"),
  refreshTokenExpiresAt: tz("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: tz("expires_at").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});
```

`src/modules/identity/infrastructure/better-auth.ts`:

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { Database } from "@/shared/infrastructure/db/client";
import { account, session, user, verification } from "./auth.schema";

export const createAuth = (opts: { db: Database; secret: string; baseURL: string }) =>
  betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(opts.db, { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    user: {
      additionalFields: {
        locale: { type: "string", required: false, defaultValue: "es", input: false },
        timezone: { type: "string", required: false, defaultValue: "America/Bogota", input: false },
      },
    },
    advanced: { cookiePrefix: "hearth" },
    plugins: [bearer()],
  });

export type Auth = ReturnType<typeof createAuth>;
```

Cross-check the hand-written schema against Better Auth's generator:

```bash
pnpm dlx auth@1.7.7 generate --config src/modules/identity/infrastructure/better-auth.ts --output /tmp/better-auth-schema.ts --yes
```

(If a flag is rejected, check `pnpm dlx auth@1.7.7 generate --help` and use the equivalent option.) Expected: the generated tables have the same columns as `auth.schema.ts`. If the generator lists a column that is missing above, add it to `auth.schema.ts` with the same property name and a snake_case column name.

Run: `pnpm db:generate --name auth`
Expected: `drizzle/0001_auth.sql` creates `user`, `session`, `account`, `verification`.

- [ ] **Step 2: Confirm Better Auth's error codes**

Run: `rg -o "USER_ALREADY_EXISTS[A-Z_]*|PASSWORD_TOO_SHORT|PASSWORD_TOO_LONG|INVALID_EMAIL_OR_PASSWORD|INVALID_EMAIL\b" -N node_modules/better-auth/dist | sort -u`
Expected: the list includes a `USER_ALREADY_EXISTS…` code, `PASSWORD_TOO_SHORT`, `INVALID_EMAIL_OR_PASSWORD` and `INVALID_EMAIL`. The mapping in Step 5 matches `USER_ALREADY_EXISTS` as a prefix, so either `USER_ALREADY_EXISTS` or `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` works; if a code is spelled differently, update `ERROR_CODES` accordingly.

- [ ] **Step 3: Write the failing use-case unit test**

`src/modules/identity/application/sign-up.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import { createSignIn } from "./sign-in";
import { createSignUp, normalizeEmail } from "./sign-up";

const ana: AuthUser = { id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es", timezone: "America/Bogota" };
const session: AuthSession = { user: ana, token: "t", cookies: ["hearth.session_token=x"] };
const provider = (overrides: Partial<AuthProvider> = {}): AuthProvider => ({
  signUp: vi.fn(async () => ok(session)),
  signIn: vi.fn(async () => ok(session)),
  signOut: vi.fn(async () => ok({ cookies: [] })),
  deleteUser: vi.fn(async () => undefined),
  ...overrides,
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("SignUp", () => {
  it("creates the account with a normalized email and provisions the user", async () => {
    const auth = provider();
    const provisionUser = vi.fn(async () => ok(undefined));
    const result = await createSignUp({ auth, provisionUser })({ name: "Ana", email: " ANA@example.com", password: "123456789012" });
    expect(result).toEqual(ok(session));
    expect(auth.signUp).toHaveBeenCalledWith({ name: "Ana", email: "ana@example.com", password: "123456789012" });
    expect(provisionUser).toHaveBeenCalledWith(ana);
  });

  it("passes provider errors through unchanged", async () => {
    const auth = provider({ signUp: vi.fn(async () => err(domainError("EmailTaken"))) });
    const result = await createSignUp({ auth, provisionUser: vi.fn() })({ name: "Ana", email: "a@b.co", password: "x" });
    expect(!result.ok && result.error.code).toBe("EmailTaken");
  });

  it.each([
    ["returns an Err", async () => err(domainError("Boom"))],
    ["throws", async () => { throw new Error("db down"); }],
  ])("deletes the user and fails with InternalError when provisioning %s", async (_label, provisionUser) => {
    const auth = provider();
    const result = await createSignUp({ auth, provisionUser })({ name: "Ana", email: "a@b.co", password: "x" });
    expect(!result.ok && result.error.code).toBe("InternalError");
    expect(auth.deleteUser).toHaveBeenCalledWith("u-ana");
  });
});

describe("SignIn", () => {
  it("normalizes the email before delegating", async () => {
    const auth = provider();
    await createSignIn(auth)({ email: " Ana@Example.com ", password: "p" });
    expect(auth.signIn).toHaveBeenCalledWith({ email: "ana@example.com", password: "p" });
  });
});
```

Run: `pnpm vitest run --project unit src/modules/identity`
Expected: FAIL — `Cannot find module './auth-provider'`.

- [ ] **Step 4: Implement the identity application layer**

`src/modules/identity/application/auth-provider.ts`:

```ts
import type { AuthUser, Result } from "@/shared/kernel";

export interface AuthSession {
  readonly user: AuthUser;
  /** Bearer token for non-browser clients. */
  readonly token: string | null;
  /** Set-Cookie header values for browsers. */
  readonly cookies: readonly string[];
}

export interface AuthProvider {
  signUp(input: { name: string; email: string; password: string }): Promise<Result<AuthSession>>;
  signIn(input: { email: string; password: string }): Promise<Result<AuthSession>>;
  signOut(credentials: { cookie?: string; authorization?: string }): Promise<Result<{ cookies: readonly string[] }>>;
  /** Compensation when post-sign-up provisioning fails (sessions and accounts cascade). */
  deleteUser(userId: string): Promise<void>;
}
```

`src/modules/identity/application/sign-up.ts`:

```ts
import { domainError, err, type AuthUser, type Result } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface SignUpDeps {
  readonly auth: AuthProvider;
  /** Creates everything a new user needs (the personal space, Task 11). */
  readonly provisionUser: (user: AuthUser) => Promise<Result<void>>;
}

export type SignUp = (input: { name: string; email: string; password: string }) => Promise<Result<AuthSession>>;

export const createSignUp =
  (deps: SignUpDeps): SignUp =>
  async (input) => {
    const created = await deps.auth.signUp({ ...input, email: normalizeEmail(input.email) });
    if (!created.ok) return created;
    let provisioned: Result<void>;
    try {
      provisioned = await deps.provisionUser(created.value.user);
    } catch {
      provisioned = err(domainError("InternalError"));
    }
    if (provisioned.ok) return created;
    // Better Auth commits the user before we can provision; compensate so no half-created user remains.
    await deps.auth.deleteUser(created.value.user.id);
    return err(domainError("InternalError", { cause: provisioned.error.code }));
  };
```

`src/modules/identity/application/sign-in.ts`:

```ts
import type { Result } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import { normalizeEmail } from "./sign-up";

export type SignIn = (input: { email: string; password: string }) => Promise<Result<AuthSession>>;

export const createSignIn =
  (auth: AuthProvider): SignIn =>
  (input) =>
    auth.signIn({ email: normalizeEmail(input.email), password: input.password });
```

`src/modules/identity/application/sign-out.ts`:

```ts
import type { Result } from "@/shared/kernel";
import type { AuthProvider } from "./auth-provider";

export type SignOut = (credentials: { cookie?: string; authorization?: string }) => Promise<Result<{ cookies: readonly string[] }>>;

export const createSignOut =
  (auth: AuthProvider): SignOut =>
  (credentials) =>
    auth.signOut(credentials);
```

`src/modules/identity/application/index.ts`:

```ts
export type { AuthProvider, AuthSession } from "./auth-provider";
export { createSignIn, type SignIn } from "./sign-in";
export { createSignOut, type SignOut } from "./sign-out";
export { createSignUp, normalizeEmail, type SignUp, type SignUpDeps } from "./sign-up";
```

Run: `pnpm vitest run --project unit src/modules/identity`
Expected: PASS.

- [ ] **Step 5: Implement the Better Auth adapter**

Strict TDD: before this step, create `tests/support/app.ts` and `tests/acceptance/auth.test.ts` from Step 7 and run `pnpm test:acceptance`; expected FAIL with missing modules (`better-auth-provider`, the auth routes). Then implement Steps 5–6.

`src/modules/identity/infrastructure/better-auth-provider.ts`:

```ts
import { eq } from "drizzle-orm";
import type { SessionResolver } from "@/shared/http";
import type { Database } from "@/shared/infrastructure/db/client";
import { domainError, err, ok, type AuthUser, type DomainError, type Result } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "../application/auth-provider";
import { user } from "./auth.schema";
import type { Auth } from "./better-auth";

const ERROR_CODES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^USER_ALREADY_EXISTS/, "EmailTaken"],
  [/^PASSWORD_TOO_SHORT$/, "PasswordTooShort"],
  [/^PASSWORD_TOO_LONG$/, "InvalidPassword"],
  [/^INVALID_EMAIL_OR_PASSWORD$/, "InvalidCredentials"],
  [/^INVALID_EMAIL$/, "InvalidEmail"],
];

const toAuthUser = (u: Record<string, unknown>): AuthUser => ({
  id: String(u.id),
  name: String(u.name),
  email: String(u.email),
  locale: String(u.locale ?? "es"),
  timezone: String(u.timezone ?? "America/Bogota"),
});

const toDomainError = async (response: Response): Promise<DomainError> => {
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  const match = ERROR_CODES.find(([pattern]) => pattern.test(body.code ?? ""));
  return domainError(match?.[1] ?? "InternalError", { provider: body.code ?? response.status });
};

export class BetterAuthProvider implements AuthProvider, SessionResolver {
  constructor(
    private readonly auth: Auth,
    private readonly db: Database,
  ) {}

  async signUp(input: { name: string; email: string; password: string }): Promise<Result<AuthSession>> {
    return this.toSession(await this.auth.api.signUpEmail({ body: input, asResponse: true }));
  }

  async signIn(input: { email: string; password: string }): Promise<Result<AuthSession>> {
    return this.toSession(await this.auth.api.signInEmail({ body: input, asResponse: true }));
  }

  async signOut(credentials: { cookie?: string; authorization?: string }): Promise<Result<{ cookies: readonly string[] }>> {
    const headers = new Headers();
    if (credentials.cookie) headers.set("cookie", credentials.cookie);
    if (credentials.authorization) headers.set("authorization", credentials.authorization);
    const response = await this.auth.api.signOut({ headers, asResponse: true });
    return response.ok ? ok({ cookies: response.headers.getSetCookie() }) : err(await toDomainError(response));
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(user).where(eq(user.id, userId));
  }

  async resolve(headers: Headers): Promise<AuthUser | null> {
    const result = await this.auth.api.getSession({ headers });
    return result ? toAuthUser(result.user as Record<string, unknown>) : null;
  }

  private async toSession(response: Response): Promise<Result<AuthSession>> {
    if (!response.ok) return err(await toDomainError(response));
    const body = (await response.json()) as { user: Record<string, unknown>; token?: string | null };
    return ok({
      user: toAuthUser(body.user),
      token: response.headers.get("set-auth-token") ?? body.token ?? null,
      cookies: response.headers.getSetCookie(),
    });
  }
}
```

- [ ] **Step 6: Contracts, container and routes**

`src/modules/identity/contracts/auth.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";
import { MeResponseSchema } from "./me.contract";

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: "Invalid email" });

/** Password length rules are enforced by the auth provider so clients get PasswordTooShort, not ValidationFailed. */
export const SignUpBodySchema = z.object({ name: z.string().trim().min(1).max(100), email: Email, password: z.string().max(128) });
export const SignInBodySchema = z.object({ email: Email, password: z.string().max(128) });
export const SignUpResponseSchema = z.object({ user: MeResponseSchema });
export const SignInResponseSchema = z.object({ user: MeResponseSchema, token: z.string().nullable() });

const json = (schema: z.ZodType) => ({ "application/json": { schema } });

export const authPaths: ZodOpenApiPathsObject = {
  "/api/v1/auth/sign-up": {
    post: {
      operationId: "signUp",
      summary: "Create an account and start a session",
      requestBody: { content: json(SignUpBodySchema) },
      responses: {
        "201": { description: "Account created; sets the session cookie", content: json(SignUpResponseSchema) },
        "409": { description: "EmailTaken", content: problemContent },
        "422": { description: "ValidationFailed, PasswordTooShort, InvalidEmail", content: problemContent },
      },
    },
  },
  "/api/v1/auth/sign-in": {
    post: {
      operationId: "signIn",
      summary: "Start a session (cookie) and get a Bearer token",
      requestBody: { content: json(SignInBodySchema) },
      responses: {
        "200": { description: "Signed in", content: json(SignInResponseSchema) },
        "401": { description: "InvalidCredentials", content: problemContent },
      },
    },
  },
  "/api/v1/auth/sign-out": {
    post: {
      operationId: "signOut",
      summary: "Revoke the current session",
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      responses: {
        "204": { description: "Signed out" },
        "401": { description: "Unauthenticated", content: problemContent },
      },
    },
  },
};
```

`src/composition/container.ts` (replace):

```ts
import type { Pool } from "pg";
import { createAuth } from "@/modules/identity/infrastructure/better-auth";
import { BetterAuthProvider } from "@/modules/identity/infrastructure/better-auth-provider";
import { createSignIn, createSignOut, createSignUp, type SignIn, type SignOut, type SignUp } from "@/modules/identity/application";
import { jsonLogger, type IdempotencyDeps, type RouteDeps } from "@/shared/http";
import { createDatabase, type Database } from "@/shared/infrastructure/db/client";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { DrizzleIdempotencyStore } from "@/shared/infrastructure/drizzle-idempotency-store";
import { loadEnv, type Env } from "@/shared/infrastructure/env";
import { ok, type AuthUser, type Result } from "@/shared/kernel";

export interface Container extends RouteDeps {
  readonly db: Database;
  readonly pool: Pool;
  readonly tm: DrizzleTransactionManager;
  readonly idempotency: IdempotencyDeps;
  readonly identity: { readonly signUp: SignUp; readonly signIn: SignIn; readonly signOut: SignOut };
}

export interface ContainerOptions {
  /** Test seam: replaces the post-sign-up provisioning step. */
  readonly provisionUser?: (user: AuthUser) => Promise<Result<void>>;
}

export const buildContainer = (env: Env, options: ContainerOptions = {}): Container => {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const tm = new DrizzleTransactionManager(db);
  const provider = new BetterAuthProvider(createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL }), db);
  const provisionUser = options.provisionUser ?? (async () => ok(undefined));
  return {
    db,
    pool,
    tm,
    logger: jsonLogger,
    sessionResolver: provider,
    idempotency: { tm, store: new DrizzleIdempotencyStore(tm) },
    identity: {
      signUp: createSignUp({ auth: provider, provisionUser }),
      signIn: createSignIn(provider),
      signOut: createSignOut(provider),
    },
  };
};

let container: Container | undefined;

export const getContainer = (): Container => (container ??= buildContainer(loadEnv()));

export const setContainerForTests = (next: Container | undefined): void => {
  container = next;
};
```

In `src/composition/openapi.ts`, import `authPaths` from `@/modules/identity/contracts/auth.contract` and add `...authPaths` to `paths`.

`src/app/api/v1/auth/sign-up/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { SignUpBodySchema } from "@/modules/identity/contracts/auth.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "none",
  body: SignUpBodySchema,
  handler: async ({ body }) => {
    const result = await getContainer().identity.signUp(body);
    if (!result.ok) return result;
    return ok({
      status: 201,
      body: { user: result.value.user },
      headers: result.value.cookies.map((cookie) => ["set-cookie", cookie] as const),
    });
  },
});
```

`src/app/api/v1/auth/sign-in/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { SignInBodySchema } from "@/modules/identity/contracts/auth.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "none",
  body: SignInBodySchema,
  handler: async ({ body }) => {
    const result = await getContainer().identity.signIn(body);
    if (!result.ok) return result;
    return ok({
      status: 200,
      body: { user: result.value.user, token: result.value.token },
      headers: result.value.cookies.map((cookie) => ["set-cookie", cookie] as const),
    });
  },
});
```

`src/app/api/v1/auth/sign-out/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ request }) => {
    const result = await getContainer().identity.signOut({
      cookie: request.headers.get("cookie") ?? undefined,
      authorization: request.headers.get("authorization") ?? undefined,
    });
    if (!result.ok) return result;
    return ok({ status: 204, headers: result.value.cookies.map((cookie) => ["set-cookie", cookie] as const) });
  },
});
```

- [ ] **Step 7: Write the acceptance helpers and the failing acceptance test**

`tests/support/app.ts`:

```ts
import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import { buildContainer, setContainerForTests, type Container, type ContainerOptions } from "@/composition/container";

export const startTestApp = (options: ContainerOptions = {}): Container => {
  const container = buildContainer(
    {
      DATABASE_URL: inject("databaseUrl"),
      BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
      BETTER_AUTH_URL: "http://localhost:3000",
      APP_TIMEZONE: "America/Bogota",
      LOG_LEVEL: "error",
    },
    options,
  );
  setContainerForTests(container);
  return container;
};

export const apiRequest = (method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

/** Turns Set-Cookie headers into a Cookie request header. */
export const cookieHeader = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

export const uniqueEmail = (name: string): string => `${name}-${randomUUID()}@example.com`;
```

`tests/acceptance/auth.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signIn } from "@/app/api/v1/auth/sign-in/route";
import { POST as signOut } from "@/app/api/v1/auth/sign-out/route";
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { GET as me } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { apiRequest, cookieHeader, startTestApp, uniqueEmail } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const register = (email: string, password = "123456789012") =>
  signUp(apiRequest("POST", "/api/v1/auth/sign-up", { body: { name: "Ana", email, password } }));

describe("email and password authentication", () => {
  it("signs up Ana with defaults and a working session cookie", async () => {
    const response = await register(uniqueEmail("ana"));
    expect(response.status).toBe(201);
    const { user } = await response.json();
    expect(user).toMatchObject({ name: "Ana", locale: "es", timezone: "America/Bogota" });
    const current = await me(apiRequest("GET", "/api/v1/me", { headers: { cookie: cookieHeader(response) } }));
    expect(current.status).toBe(200);
    expect((await current.json()).id).toBe(user.id);
  });

  it("rejects a duplicate email regardless of case", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const response = await register(email.toUpperCase());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("EmailTaken");
    const { rows } = await app.pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [email]);
    expect(rows[0].n).toBe(1);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const response = await register(uniqueEmail("ana"), "1234567");
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PasswordTooShort");
  });

  it("returns the same generic error for a wrong password and an unknown email", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const wrong = await signIn(apiRequest("POST", "/api/v1/auth/sign-in", { body: { email, password: "wrong-password" } }));
    const unknown = await signIn(apiRequest("POST", "/api/v1/auth/sign-in", { body: { email: uniqueEmail("nobody"), password: "x" } }));
    const [a, b] = [await wrong.json(), await unknown.json()];
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect([a.code, b.code]).toEqual(["InvalidCredentials", "InvalidCredentials"]);
    expect(a.title).toBe(b.title);
  });

  it("signs in with different case and surrounding spaces in the email", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const response = await signIn(
      apiRequest("POST", "/api/v1/auth/sign-in", { body: { email: `  ${email.toUpperCase()} `, password: "123456789012" } }),
    );
    expect(response.status).toBe(200);
  });

  it("resolves the same user from the session cookie and the Bearer token", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const response = await signIn(apiRequest("POST", "/api/v1/auth/sign-in", { body: { email, password: "123456789012" } }));
    const { token } = await response.json();
    expect(token).toEqual(expect.any(String));
    const viaCookie = await (await me(apiRequest("GET", "/api/v1/me", { headers: { cookie: cookieHeader(response) } }))).json();
    const viaBearer = await (await me(apiRequest("GET", "/api/v1/me", { headers: { authorization: `Bearer ${token}` } }))).json();
    expect(viaBearer.id).toBe(viaCookie.id);
  });

  it("revokes the session on sign out", async () => {
    const created = await register(uniqueEmail("ana"));
    const cookie = cookieHeader(created);
    const out = await signOut(apiRequest("POST", "/api/v1/auth/sign-out", { headers: { cookie } }));
    expect(out.status).toBe(204);
    const after = await me(apiRequest("GET", "/api/v1/me", { headers: { cookie } }));
    expect(after.status).toBe(401);
    expect((await after.json()).code).toBe("Unauthenticated");
  });

  it("stores no plaintext password", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const { rows } = await app.pool.query(
      'SELECT a.password FROM account a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1',
      [email],
    );
    expect(rows[0].password).not.toContain("123456789012");
  });
});
```

(These are the files you created before Step 5.)

- [ ] **Step 8: Run everything**

Run: `pnpm test:acceptance`
Expected: PASS (8 tests).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm vitest run --project unit src/composition/openapi.test.ts` (PowerShell: see Task 8 Step 6), then inspect the diff of `openapi/openapi.snapshot.json`: it adds the three auth operations and nothing else.

Run: `pnpm test:unit && pnpm lint:boundaries && pnpm typecheck && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat(identity): add email/password sign-up, sign-in and sign-out with Better Auth (Refs #10)"
```

---

### Task 11: Personal space created on sign-up

Implements HU-E1-02 (issue #11).

**Files:**
- Create: `src/modules/spaces/domain/space.ts`
- Create: `src/modules/spaces/application/space-repository.ts`, `src/modules/spaces/application/create-personal-space.ts`, `src/modules/spaces/application/list-my-spaces.ts`, `src/modules/spaces/application/index.ts`
- Create: `src/modules/spaces/infrastructure/spaces.schema.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.ts`
- Create: `src/modules/spaces/contracts/spaces.contract.ts`
- Create: `src/app/api/v1/spaces/route.ts`
- Modify: `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`
- Create: `drizzle/0002_spaces.sql` (generated)
- Test: `src/modules/spaces/domain/space.test.ts`, `src/modules/spaces/application/create-personal-space.test.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`, `tests/acceptance/personal-space.test.ts`

**Interfaces:**
- Consumes: `Id`, `IdGenerator`, `Clock`, `FixedClock`, `TransactionManager`, `PeriodPolicy`, `DEFAULT_PERIOD_POLICY`, `Result` (kernel); `UuidV7IdGenerator`, `SystemClock`, `DrizzleTransactionManager` (infrastructure); `user` table (Task 10); `buildContainer`, `ContainerOptions`, `startTestApp`, `apiRequest`, `cookieHeader`, `uniqueEmail` (Task 10).
- Produces:
  - `type SpaceId = Id<"Space">`, `type SpaceMemberId = Id<"SpaceMember">`, `type SpaceKind = "PERSONAL" | "SHARED" | "DIRECT"`, `type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"`, `interface SpaceMember`, `interface Space`
  - `createPersonalSpace(input: { id: SpaceId; memberId: SpaceMemberId; ownerUserId: string; ownerName: string; now: Date }): Space`
  - `ensureCanAddMember(space: Space): Result<void>` (`PersonalSpaceNotShareable`)
  - `interface SpaceSummary { id: string; name: string; kind: SpaceKind; currency: string; periodPolicy: PeriodPolicy; role: SpaceRole | null }`
  - `interface SpaceRepository { add(space: Space): Promise<void>; hasPersonalSpace(userId: string): Promise<boolean>; listForUser(userId: string): Promise<SpaceSummary[]> }`
  - `createCreatePersonalSpace(deps: { spaces: SpaceRepository; ids: IdGenerator; clock: Clock; tm: TransactionManager })` → `CreatePersonalSpace = (owner: { userId: string; name: string }) => Promise<Result<Space>>` (`PersonalSpaceAlreadyExists`)
  - `createListMySpaces(spaces: SpaceRepository)` → `ListMySpaces = (userId: string) => Promise<Result<SpaceSummary[]>>`
  - `Container.spaces: { createPersonalSpace; listMySpaces }`
  - `GET /api/v1/spaces` → `{ items: SpaceSummary[] }`

- [ ] **Step 1: Write the failing domain and use-case tests**

`src/modules/spaces/domain/space.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Id } from "@/shared/kernel";
import { createPersonalSpace, ensureCanAddMember } from "./space";

const space = createPersonalSpace({
  id: "s-1" as Id<"Space">,
  memberId: "m-1" as Id<"SpaceMember">,
  ownerUserId: "u-ana",
  ownerName: "Ana",
  now: new Date("2026-10-11T12:00:00Z"),
});

describe("personal space", () => {
  it("is PERSONAL, in COP, with MONTHLY(1) and Ana as its only OWNER", () => {
    expect(space).toMatchObject({ kind: "PERSONAL", currency: "COP", periodPolicy: { kind: "MONTHLY", day: 1 } });
    expect(space.members).toEqual([
      expect.objectContaining({ kind: "USER", userId: "u-ana", displayName: "Ana", role: "OWNER" }),
    ]);
  });

  it("cannot receive members", () => {
    const result = ensureCanAddMember(space);
    expect(!result.ok && result.error.code).toBe("PersonalSpaceNotShareable");
  });
});
```

`src/modules/spaces/application/create-personal-space.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, type Id, type IdGenerator, type TransactionManager } from "@/shared/kernel";
import type { Space } from "../domain/space";
import { createCreatePersonalSpace } from "./create-personal-space";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

class InMemorySpaces implements SpaceRepository {
  readonly saved: Space[] = [];
  async add(space: Space) {
    this.saved.push(space);
  }
  async hasPersonalSpace(userId: string) {
    return this.saved.some((s) => s.kind === "PERSONAL" && s.personalOwnerUserId === userId);
  }
  async listForUser(): Promise<SpaceSummary[]> {
    return [];
  }
}

const ids = (): IdGenerator => {
  let n = 0;
  return { next: <B extends string>() => `id-${++n}` as Id<B> };
};
const tm: TransactionManager = { run: (work) => work() };

describe("CreatePersonalSpace", () => {
  it("creates exactly one personal space for the owner", async () => {
    const spaces = new InMemorySpaces();
    const create = createCreatePersonalSpace({ spaces, ids: ids(), clock: new FixedClock(new Date("2026-10-11T00:00:00Z")), tm });
    const result = await create({ userId: "u-ana", name: "Ana" });
    expect(result.ok).toBe(true);
    expect(spaces.saved).toHaveLength(1);
    expect(spaces.saved[0]).toMatchObject({ id: "id-1", kind: "PERSONAL", personalOwnerUserId: "u-ana" });
  });

  it("refuses a second personal space", async () => {
    const spaces = new InMemorySpaces();
    const create = createCreatePersonalSpace({ spaces, ids: ids(), clock: new FixedClock(new Date()), tm });
    await create({ userId: "u-ana", name: "Ana" });
    const second = await create({ userId: "u-ana", name: "Ana" });
    expect(!second.ok && second.error.code).toBe("PersonalSpaceAlreadyExists");
    expect(spaces.saved).toHaveLength(1);
  });
});
```

Run: `pnpm vitest run --project unit src/modules/spaces`
Expected: FAIL — `Cannot find module './space'` and `./create-personal-space`.

- [ ] **Step 2: Implement the domain and application layers**

`src/modules/spaces/domain/space.ts`:

```ts
import { DEFAULT_PERIOD_POLICY, domainError, err, ok, type Id, type PeriodPolicy, type Result } from "@/shared/kernel";

export type SpaceId = Id<"Space">;
export type SpaceMemberId = Id<"SpaceMember">;
export type SpaceKind = "PERSONAL" | "SHARED" | "DIRECT";
export type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface SpaceMember {
  readonly id: SpaceMemberId;
  readonly kind: "USER" | "GUEST";
  readonly userId: string | null;
  readonly displayName: string;
  readonly role: SpaceRole | null;
  readonly joinedAt: Date;
}

export interface Space {
  readonly id: SpaceId;
  readonly name: string;
  readonly kind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly personalOwnerUserId: string | null;
  readonly members: readonly SpaceMember[];
  readonly createdAt: Date;
}

export const createPersonalSpace = (input: {
  id: SpaceId;
  memberId: SpaceMemberId;
  ownerUserId: string;
  ownerName: string;
  now: Date;
}): Space => ({
  id: input.id,
  name: "Personal",
  kind: "PERSONAL",
  currency: "COP",
  periodPolicy: DEFAULT_PERIOD_POLICY,
  personalOwnerUserId: input.ownerUserId,
  members: [
    { id: input.memberId, kind: "USER", userId: input.ownerUserId, displayName: input.ownerName, role: "OWNER", joinedAt: input.now },
  ],
  createdAt: input.now,
});

/** Personal spaces have exactly one member (spec 5.2, HU-E1-02). */
export const ensureCanAddMember = (space: Space): Result<void> =>
  space.kind === "PERSONAL" ? err(domainError("PersonalSpaceNotShareable")) : ok(undefined);
```

`src/modules/spaces/application/space-repository.ts`:

```ts
import type { PeriodPolicy } from "@/shared/kernel";
import type { Space, SpaceKind, SpaceRole } from "../domain/space";

export interface SpaceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly role: SpaceRole | null;
}

export interface SpaceRepository {
  add(space: Space): Promise<void>;
  hasPersonalSpace(userId: string): Promise<boolean>;
  listForUser(userId: string): Promise<SpaceSummary[]>;
}
```

`src/modules/spaces/application/create-personal-space.ts`:

```ts
import { domainError, err, ok, type Clock, type IdGenerator, type Result, type TransactionManager } from "@/shared/kernel";
import { createPersonalSpace, type Space } from "../domain/space";
import type { SpaceRepository } from "./space-repository";

export interface CreatePersonalSpaceDeps {
  readonly spaces: SpaceRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}

export type CreatePersonalSpace = (owner: { userId: string; name: string }) => Promise<Result<Space>>;

export const createCreatePersonalSpace =
  (deps: CreatePersonalSpaceDeps): CreatePersonalSpace =>
  (owner) =>
    deps.tm.run(async () => {
      if (await deps.spaces.hasPersonalSpace(owner.userId)) return err(domainError("PersonalSpaceAlreadyExists"));
      const space = createPersonalSpace({
        id: deps.ids.next<"Space">(),
        memberId: deps.ids.next<"SpaceMember">(),
        ownerUserId: owner.userId,
        ownerName: owner.name,
        now: deps.clock.now(),
      });
      await deps.spaces.add(space);
      return ok(space);
    });
```

`src/modules/spaces/application/list-my-spaces.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

export type ListMySpaces = (userId: string) => Promise<Result<SpaceSummary[]>>;

export const createListMySpaces =
  (spaces: SpaceRepository): ListMySpaces =>
  async (userId) =>
    ok(await spaces.listForUser(userId));
```

`src/modules/spaces/application/index.ts`:

```ts
export type { Space, SpaceKind, SpaceRole } from "../domain/space";
export { ensureCanAddMember } from "../domain/space";
export { createCreatePersonalSpace, type CreatePersonalSpace } from "./create-personal-space";
export { createListMySpaces, type ListMySpaces } from "./list-my-spaces";
export type { SpaceRepository, SpaceSummary } from "./space-repository";
```

Run: `pnpm vitest run --project unit src/modules/spaces`
Expected: PASS.

- [ ] **Step 3: Write the schema and the failing repository integration test**

`src/modules/spaces/infrastructure/spaces.schema.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";
import type { PeriodPolicy } from "@/shared/kernel";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["PERSONAL", "SHARED", "DIRECT"] }).notNull(),
    currency: text("currency").notNull(),
    periodPolicy: jsonb("period_policy").$type<PeriodPolicy>().notNull(),
    personalOwnerUserId: text("personal_owner_user_id")
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [check("spaces_personal_owner", sql`(${t.kind} = 'PERSONAL') = (${t.personalOwnerUserId} IS NOT NULL)`)],
);

export const spaceMembers = pgTable(
  "space_members",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["USER", "GUEST"] }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["OWNER", "ADMIN", "MEMBER", "VIEWER"] }),
    joinedAt: tz("joined_at").notNull(),
    leftAt: tz("left_at"),
    claimedAt: tz("claimed_at"),
  },
  (t) => [unique("space_members_space_user").on(t.spaceId, t.userId)],
);
```

Run: `pnpm db:generate --name spaces`
Expected: `drizzle/0002_spaces.sql` with both tables, the unique constraint and the check constraint.

`src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { Id } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { createPersonalSpace } from "../domain/space";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleSpaceRepository(new DrizzleTransactionManager(db));
const newUser = async () => {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [id, "Ana", `${id}@example.com`]);
  return id;
};
const personal = (userId: string) =>
  createPersonalSpace({
    id: randomUUID() as Id<"Space">,
    memberId: randomUUID() as Id<"SpaceMember">,
    ownerUserId: userId,
    ownerName: "Ana",
    now: new Date(),
  });

afterAll(() => pool.end());

describe("DrizzleSpaceRepository", () => {
  it("persists a personal space and lists it for its owner", async () => {
    const userId = await newUser();
    const space = personal(userId);
    await repo.add(space);
    expect(await repo.hasPersonalSpace(userId)).toBe(true);
    expect(await repo.listForUser(userId)).toEqual([
      { id: space.id, name: "Personal", kind: "PERSONAL", currency: "COP", periodPolicy: { kind: "MONTHLY", day: 1 }, role: "OWNER" },
    ]);
  });

  it("enforces one personal space per user in the database", async () => {
    const userId = await newUser();
    await repo.add(personal(userId));
    await expect(repo.add(personal(userId))).rejects.toThrow();
  });
});
```

Run: `pnpm vitest run --project integration src/modules/spaces`
Expected: FAIL — `Cannot find module './drizzle-space-repository'`.

- [ ] **Step 4: Implement the repository**

`src/modules/spaces/infrastructure/drizzle-space-repository.ts`:

```ts
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { SpaceRepository, SpaceSummary } from "../application/space-repository";
import type { Space } from "../domain/space";
import { spaceMembers, spaces } from "./spaces.schema";

export class DrizzleSpaceRepository implements SpaceRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(space: Space): Promise<void> {
    const db = this.tm.executor();
    await db.insert(spaces).values({
      id: space.id,
      name: space.name,
      kind: space.kind,
      currency: space.currency,
      periodPolicy: space.periodPolicy,
      personalOwnerUserId: space.personalOwnerUserId,
      createdAt: space.createdAt,
    });
    await db.insert(spaceMembers).values(
      space.members.map((m) => ({
        id: m.id,
        spaceId: space.id,
        kind: m.kind,
        userId: m.userId,
        displayName: m.displayName,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    );
  }

  async hasPersonalSpace(userId: string): Promise<boolean> {
    const rows = await this.tm
      .executor()
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.personalOwnerUserId, userId))
      .limit(1);
    return rows.length > 0;
  }

  async listForUser(userId: string): Promise<SpaceSummary[]> {
    return this.tm
      .executor()
      .select({
        id: spaces.id,
        name: spaces.name,
        kind: spaces.kind,
        currency: spaces.currency,
        periodPolicy: spaces.periodPolicy,
        role: spaceMembers.role,
      })
      .from(spaces)
      .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
      .where(and(eq(spaceMembers.userId, userId), isNull(spaceMembers.leftAt), isNull(spaces.archivedAt)))
      .orderBy(asc(spaces.createdAt));
  }
}
```

Allow schema files to reference other modules' tables. In `.dependency-cruiser.cjs`, change the `modules-only-through-public-application-api` rule and add `schemas-only-reference-schemas`:

```js
    {
      name: "modules-only-through-public-application-api",
      severity: "error",
      comment:
        "Modules may only import another module's public application API (src/modules/<module>/application/index.ts).",
      from: { path: "^src/modules/([^/]+)/", pathNot: "\\.schema\\.ts$" },
      to: { path: "^src/modules/(?!$1/)[^/]+/", pathNot: "^src/modules/[^/]+/application/index\\.ts$" },
    },
    {
      name: "schemas-only-reference-schemas",
      severity: "error",
      comment: "A *.schema.ts file may reference another module's *.schema.ts (foreign keys) and nothing else of that module.",
      from: { path: "^src/modules/([^/]+)/infrastructure/[^/]+\\.schema\\.ts$" },
      to: { path: "^src/modules/(?!$1/)[^/]+/", pathNot: "\\.schema\\.ts$" },
    },
```

Append to `docs/adr/0001-boundary-enforcement-with-dependency-cruiser.md`:

```markdown
## Amendment (Task 11)

Drizzle table files (`*.schema.ts`) may import other modules' table files to declare foreign keys. They may import nothing else from another module (rule `schemas-only-reference-schemas`). Ownership stays with each module; only referential integrity crosses the boundary.
```

Run: `pnpm vitest run --project integration src/modules/spaces && pnpm vitest run --project unit tests/architecture && pnpm lint:boundaries`
Expected: PASS, PASS, no violations.

- [ ] **Step 5: Contract, route and wiring**

Strict TDD: before this step, create `tests/acceptance/personal-space.test.ts` from Step 6 and run `pnpm test:acceptance`; expected FAIL (`@/app/api/v1/spaces/route` is missing). Then implement this step.

`src/modules/spaces/contracts/spaces.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";

export const PeriodPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int().min(1).max(31) }),
  z.object({ kind: z.literal("SEMI_MONTHLY"), day1: z.number().int().min(1).max(31), day2: z.number().int().min(1).max(31) }),
]);

export const SpaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["PERSONAL", "SHARED", "DIRECT"]),
  currency: z.string(),
  periodPolicy: PeriodPolicySchema,
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).nullable(),
});

export const ListSpacesResponseSchema = z.object({ items: z.array(SpaceSummarySchema) });

export const spacesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces": {
    get: {
      operationId: "listMySpaces",
      summary: "Spaces the authenticated user belongs to",
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      responses: {
        "200": { description: "The user's spaces", content: { "application/json": { schema: ListSpacesResponseSchema } } },
        "401": { description: "Unauthenticated", content: problemContent },
      },
    },
  },
};
```

`src/app/api/v1/spaces/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().spaces.listMySpaces(user!.id);
    return result.ok ? ok({ status: 200, body: { items: result.value } }) : result;
  },
});
```

In `src/composition/openapi.ts`, import `spacesPaths` from `@/modules/spaces/contracts/spaces.contract` and add `...spacesPaths`.

In `src/composition/container.ts`:

1. Add imports:

```ts
import { createCreatePersonalSpace, createListMySpaces, type CreatePersonalSpace, type ListMySpaces } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { SystemClock } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { map } from "@/shared/kernel";
```

2. Add to `interface Container`:

```ts
  readonly spaces: { readonly createPersonalSpace: CreatePersonalSpace; readonly listMySpaces: ListMySpaces };
```

3. In `buildContainer`, replace the `provisionUser` line and add `spaces` to the returned object:

```ts
  const spaceRepository = new DrizzleSpaceRepository(tm);
  const createPersonalSpace = createCreatePersonalSpace({ spaces: spaceRepository, ids: new UuidV7IdGenerator(), clock: new SystemClock(), tm });
  const provisionUser =
    options.provisionUser ?? (async (u: AuthUser) => map(await createPersonalSpace({ userId: u.id, name: u.name }), () => undefined));
```

```ts
    spaces: { createPersonalSpace, listMySpaces: createListMySpaces(spaceRepository) },
```

Remove the now-unused `ok` import if TypeScript reports it.

- [ ] **Step 6: Write and run the acceptance test**

`tests/acceptance/personal-space.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { apiRequest, cookieHeader, startTestApp, uniqueEmail } from "../support/app";

let app: Container | undefined;
afterEach(async () => {
  setContainerForTests(undefined);
  await app?.pool.end();
  app = undefined;
});

const register = (email: string) =>
  signUp(apiRequest("POST", "/api/v1/auth/sign-up", { body: { name: "Ana", email, password: "123456789012" } }));

describe("personal space on sign-up", () => {
  it("creates exactly one PERSONAL space in COP with MONTHLY(1) and Ana as OWNER", async () => {
    app = startTestApp();
    const created = await register(uniqueEmail("ana"));
    expect(created.status).toBe(201);
    const response = await listSpaces(apiRequest("GET", "/api/v1/spaces", { headers: { cookie: cookieHeader(created) } }));
    const { items } = await response.json();
    expect(items).toEqual([
      expect.objectContaining({ kind: "PERSONAL", currency: "COP", periodPolicy: { kind: "MONTHLY", day: 1 }, role: "OWNER" }),
    ]);
  });

  it("rolls back the user when the personal space cannot be created", async () => {
    app = startTestApp({
      provisionUser: async () => {
        throw new Error("simulated database error");
      },
    });
    const email = uniqueEmail("ana");
    const response = await register(email);
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(body.code).toBe("InternalError");
    expect(body.requestId).toEqual(expect.any(String));
    const { rows } = await app.pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [email]);
    expect(rows[0].n).toBe(0);
  });
});
```

Run: `pnpm test:acceptance`
Expected: PASS (auth + personal-space files).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm vitest run --project unit src/composition/openapi.test.ts`, inspect that the snapshot diff only adds `GET /api/v1/spaces`, then `pnpm test:unit && pnpm typecheck && pnpm lint:boundaries && pnpm db:check`.
Expected: all exit 0.

Note for the PR: `POST /api/v1/spaces` (which must answer `PersonalSpaceAlreadyExists` for kind `PERSONAL`) and the invitation endpoint arrive with HU-E1-04 and HU-E1-06; both reuse `createCreatePersonalSpace`'s guard and `ensureCanAddMember`, which are covered here.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(spaces): create a personal space atomically with sign-up (Refs #11)"
```

---

### Task 12: Production images, Compose stack and deployment

Implements HU-E0-07 (issue #7).

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `compose.yaml`, `compose.local.yaml`, `Caddyfile`, `.env.production.example`
- Create: `src/instrumentation.ts`
- Create: `docs/operations/deploy.md`

**Interfaces:**
- Consumes: `loadEnv` (Task 6); `scripts/migrate.mjs` (Task 6); `next.config.ts` standalone output (Task 1).
- Produces: Docker targets `runner` (Next.js standalone server, port 3000, healthcheck on `/api/v1/health`) and `migrator` (runs `scripts/migrate.mjs`); production services `db`, `migrate`, `app`, `caddy`.

- [ ] **Step 1: Validate the environment at server start**

`src/instrumentation.ts`:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadEnv } = await import("@/shared/infrastructure/env");
  try {
    loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
```

- [ ] **Step 2: Write the Dockerfile**

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24.21.0-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm build

FROM base AS migrator
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY drizzle ./drizzle
COPY scripts/migrate.mjs ./scripts/migrate.mjs
USER node
CMD ["node", "scripts/migrate.mjs"]

FROM node:24.21.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["node", "server.js"]
```

`.dockerignore`:

```
.git
.next
node_modules
coverage
tests
scripts/*.test.mjs
**/*.test.ts
**/*.int.test.ts
.env
.env.*
docs
openapi
```

- [ ] **Step 3: Write the production stack**

`compose.yaml`:

```yaml
name: hearth

services:
  db:
    image: postgres:18.6-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: hearth
      POSTGRES_USER: hearth
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
    volumes: [db-data:/var/lib/postgresql]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hearth -d hearth"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks: [internal]

  migrate:
    image: ${HEARTH_MIGRATOR_IMAGE:?HEARTH_MIGRATOR_IMAGE is required}
    environment:
      DATABASE_URL: postgres://hearth:${POSTGRES_PASSWORD}@db:5432/hearth
    depends_on:
      db: { condition: service_healthy }
    restart: "no"
    networks: [internal]

  app:
    image: ${HEARTH_APP_IMAGE:?HEARTH_APP_IMAGE is required}
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://hearth:${POSTGRES_PASSWORD}@db:5432/hearth
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-}
      BETTER_AUTH_URL: https://${HEARTH_DOMAIN}
      APP_TIMEZONE: ${APP_TIMEZONE:-America/Bogota}
    depends_on:
      migrate: { condition: service_completed_successfully }
    networks: [internal]

  caddy:
    image: caddy:2.11.7-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    environment:
      HEARTH_DOMAIN: ${HEARTH_DOMAIN:?HEARTH_DOMAIN is required}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      app: { condition: service_healthy }
    networks: [internal]

networks:
  internal: {}

volumes:
  db-data: {}
  caddy-data: {}
  caddy-config: {}
```

`BETTER_AUTH_SECRET` intentionally has no `:?` guard: if it is missing, the app container itself must exit naming the variable (HU-E0-07), which `src/instrumentation.ts` does.

`Caddyfile`:

```
{$HEARTH_DOMAIN} {
	encode zstd gzip
	reverse_proxy app:3000
}
```

`compose.local.yaml` (local production smoke test; builds images instead of pulling them):

```yaml
services:
  migrate:
    build: { context: ., target: migrator }
  app:
    build: { context: ., target: runner }
```

`.env.production.example`:

```dotenv
# Copy to .env on the VPS. Generate secrets with: openssl rand -base64 48
HEARTH_DOMAIN=hearth.example.com
POSTGRES_PASSWORD=
BETTER_AUTH_SECRET=
HEARTH_APP_IMAGE=ghcr.io/facabore/hearth:<commit-sha>
HEARTH_MIGRATOR_IMAGE=ghcr.io/facabore/hearth-migrator:<commit-sha>
APP_TIMEZONE=America/Bogota
```

- [ ] **Step 4: Smoke-test the production stack locally**

Create `.env.local-smoke` (git-ignored by `.env.*`):

```dotenv
HEARTH_DOMAIN=localhost
POSTGRES_PASSWORD=local-smoke-password
BETTER_AUTH_SECRET=local-smoke-secret-0123456789abcdef01
HEARTH_APP_IMAGE=hearth:local
HEARTH_MIGRATOR_IMAGE=hearth-migrator:local
```

Run: `docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local-smoke up -d --build`
Expected: `docker compose ... ps` shows `db` healthy, `migrate` exited 0, `app` healthy, `caddy` running.

Run: `curl -sk https://localhost/api/v1/health`
Expected: `{"status":"ok"}` (Caddy serves `localhost` with its internal CA, hence `-k`).

Run: `curl -sk https://localhost/api/v1/openapi.json | head -c 40`
Expected: starts with `{"openapi":"3.1.0"`.

Run: `curl -sI http://localhost`
Expected: `308 Permanent Redirect` with `Location: https://localhost/`.

Run: `docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local-smoke port db 5432`
Expected: no published port (the database is reachable only on the internal network).

Run: `docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local-smoke run --rm -e BETTER_AUTH_SECRET= app`
Expected: the container exits with status 1 and prints `Missing or invalid environment variables: BETTER_AUTH_SECRET`.

Run: `docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local-smoke logs migrate`
Expected: `Migrations applied.` appears before the app became healthy.

Run: `docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local-smoke down -v`

- [ ] **Step 5: Write the runbook**

`docs/operations/deploy.md`:

```markdown
# Deploying Hearth to a VPS

## Prerequisites

- A Linux VPS with Docker Engine and the Compose plugin.
- A DNS `A`/`AAAA` record for your domain pointing at the VPS.
- Inbound TCP 80 and 443 (and UDP 443 for HTTP/3) open; nothing else needs to be public. PostgreSQL is never published.
- Access to the images: either make the GHCR packages `hearth` and `hearth-migrator` public in GitHub, or run `docker login ghcr.io` on the VPS with a token that has `read:packages`.

## First deployment

1. Copy `compose.yaml` and `Caddyfile` to a directory on the VPS, e.g. `/opt/hearth`.
2. Create `/opt/hearth/.env` from `.env.production.example`; set `HEARTH_DOMAIN`, generate `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` with `openssl rand -base64 48`, and set both image tags to the commit SHA built by CI on `main`.
3. `docker compose pull && docker compose up -d`
4. Verify:
   - `docker compose ps` — `migrate` exited 0; `db` and `app` healthy; `caddy` running.
   - `curl -s https://$HEARTH_DOMAIN/api/v1/health` → `{"status":"ok"}` with a valid certificate.
   - `curl -s https://$HEARTH_DOMAIN/api/v1/openapi.json | head -c 40` → `{"openapi":"3.1.0"…`.

## Updating

1. Set `HEARTH_APP_IMAGE` and `HEARTH_MIGRATOR_IMAGE` in `.env` to the new SHA.
2. `docker compose pull && docker compose up -d` — `migrate` runs pending migrations before `app` starts.

## Rolling back

Set both image tags back to the previous SHA and run `docker compose up -d`. Migrations are forward-only; a release whose migration is not backward compatible must say so in its PR.

## Backups

Nightly `pg_dump` and a restore drill arrive with HU-E8-01. Until then, take a manual dump before every update:

    docker compose exec db pg_dump -U hearth -Fc hearth > hearth-$(date +%F).dump
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(deploy): add production images, Compose stack with Caddy and runbook (Refs #7)"
```

---


### Task 13: Continuous integration

Implements HU-E0-06 (issue #6).

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: every pnpm script; the Dockerfile targets `runner` and `migrator` and the runbook (Task 12).
- Produces: required status checks `lint`, `boundaries`, `typecheck`, `test`, `build-image`; images `ghcr.io/facabore/hearth:<sha>` and `ghcr.io/facabore/hearth-migrator:<sha>` (plus `:main`) on pushes to `main`.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm check:pinned
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm db:check

  boundaries:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint:boundaries

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Unit, integration (Testcontainers) and acceptance tests
        run: pnpm test

  build-image:
    needs: [lint, boundaries, typecheck, test]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    env:
      APP_IMAGE: ghcr.io/facabore/hearth
      MIGRATOR_IMAGE: ghcr.io/facabore/hearth-migrator
    steps:
      - uses: actions/checkout@v5
      - uses: docker/setup-buildx-action@v3
      - name: Build app image
        uses: docker/build-push-action@v6
        with:
          context: .
          target: runner
          load: true
          tags: ${{ env.APP_IMAGE }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Build migrator image
        uses: docker/build-push-action@v6
        with:
          context: .
          target: migrator
          load: true
          tags: ${{ env.MIGRATOR_IMAGE }}:${{ github.sha }}
          cache-from: type=gha
      - name: Smoke test the images against PostgreSQL
        run: |
          docker network create smoke
          docker run -d --name db --network smoke -e POSTGRES_DB=hearth -e POSTGRES_USER=hearth -e POSTGRES_PASSWORD=hearth postgres:18.6-alpine
          until docker exec db pg_isready -U hearth -d hearth; do sleep 1; done
          docker run --rm --network smoke -e DATABASE_URL=postgres://hearth:hearth@db:5432/hearth "$MIGRATOR_IMAGE:${{ github.sha }}"
          docker run -d --name app --network smoke -p 3000:3000 \
            -e DATABASE_URL=postgres://hearth:hearth@db:5432/hearth \
            -e BETTER_AUTH_SECRET=ci-smoke-secret-0123456789abcdef0123 \
            -e BETTER_AUTH_URL=http://localhost:3000 \
            "$APP_IMAGE:${{ github.sha }}"
          for i in $(seq 1 30); do curl -fsS http://localhost:3000/api/v1/health && break; sleep 1; done
          curl -fsS http://localhost:3000/api/v1/health
          curl -fsS http://localhost:3000/api/v1/openapi.json | grep -q '"openapi":"3.1.0"'
          docker logs app
      - name: Log in to GHCR
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Push images tagged with the commit SHA and main
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          for image in "$APP_IMAGE" "$MIGRATOR_IMAGE"; do
            docker tag "$image:${{ github.sha }}" "$image:main"
            docker push "$image:${{ github.sha }}"
            docker push "$image:main"
          done
```

- [ ] **Step 2: Validate locally and push**

Run: `pnpm check:pinned && pnpm lint && pnpm format:check && pnpm db:check && pnpm lint:boundaries && pnpm typecheck && pnpm test`
Expected: all exit 0 (this is exactly what CI runs).

```bash
git add .github
git commit -m "ci: add quality gates, image build and smoke test (Refs #6)"
git push -u origin feat/m0-walking-skeleton
```

Open a draft PR so the workflow runs:

```bash
gh pr create --draft --title "M0 walking skeleton" --body "Work in progress for milestone M0. Closes #1 Closes #2 Closes #3 Closes #4 Closes #5 Closes #6 Closes #7 Closes #8 Closes #9 Closes #10 Closes #11"
```

Expected: the five jobs run; `build-image` builds both images and the smoke test passes (pushing is skipped on pull requests).

- [ ] **Step 3: Prove the gates block merges**

On a scratch commit, introduce `const x: number = "a";` in `src/app/api/v1/health/route.ts`, push, and confirm the `typecheck` job fails; revert with a new commit. Change `MeResponseSchema` without regenerating the snapshot, push, and confirm `test` fails naming `GET /api/v1/me`; revert.

- [ ] **Step 4: Require the checks on `main` (owner approval required)**

Ask the owner before running this; it changes repository settings:

```bash
gh api -X PUT repos/Facabore/Hearth/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["lint", "boundaries", "typecheck", "test", "build-image"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

Expected: `gh api repos/Facabore/Hearth/branches/main/protection --jq '.required_status_checks.contexts'` lists the five checks.

---

- [ ] **Step 5: Deploy to the VPS (requires the owner)**

Stop and ask the owner for: the domain to use, confirmation that its DNS points at the VPS, and how to reach the VPS (SSH host and user). Do not guess these values. Then follow `docs/operations/deploy.md` with the SHA of the merged `main` build, and verify the HU-E0-07 scenarios on the real domain: HTTPS health and OpenAPI, HTTP→HTTPS redirect, port 5432 refused from outside (`nc -vz $HEARTH_DOMAIN 5432` fails).

- [ ] **Step 6: Close out M0**

Mark the draft PR ready for review. When the owner merges it, issues #1–#11 close and their cards move to **Done**.
