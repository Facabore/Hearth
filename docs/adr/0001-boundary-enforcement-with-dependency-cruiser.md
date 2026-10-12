# ADR 0001 — Enforce architecture boundaries with dependency-cruiser

- Status: Accepted (2026-10-11)
- Story: HU-E0-02

## Context

The spec requires hexagonal modules whose domain never depends on frameworks or I/O, and modules that talk only through public application APIs. Candidates: dependency-cruiser and eslint-plugin-boundaries.

## Decision

Use dependency-cruiser 18.6.0 as the CI gate (`pnpm lint:boundaries`), with rules:

- `domain-must-be-pure` and `kernel-must-be-pure`: no frameworks, ORM, I/O or Node built-ins.
- `application-must-not-depend-on-adapters`: application code never imports infrastructure, contracts, UI, the app, the composition root, the HTTP layer, frameworks or the ORM.
- `modules-only-through-public-application-api`: other modules are reached only through `application/index.ts`.
- `schemas-only-reference-schemas`: a Drizzle `*.schema.ts` file may import another module's `*.schema.ts` (foreign keys) and nothing else of that module.
- `shared-must-not-depend-on-modules` and `no-circular`.

Every rule has a fixture in `tests/architecture/fixtures/` and an assertion in `tests/architecture/boundaries.test.ts`.

## Consequences

- Regex rules with back-references (`$1`) express "same module" and "other module" precisely and match package subpaths such as `drizzle-orm/pg-core`.
- It does not depend on ESLint's version or resolver plugins.
- Referential integrity may cross module boundaries at the table level; ownership of each table stays with its module.
- Editor feedback is weaker than an ESLint plugin; eslint-plugin-boundaries can be added later for in-editor hints without replacing this gate.
