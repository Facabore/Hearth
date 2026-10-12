# Modules

Each bounded context lives in `src/modules/<module>/` with:

- `domain/` — entities, value objects, domain services and errors. Pure TypeScript: imports only its own domain and `src/shared/kernel`.
- `application/` — use cases and ports. `application/index.ts` is the module's only public API for other modules.
- `contracts/` — Zod request/response schemas; the OpenAPI document is generated from them.
- `infrastructure/` — driven adapters (Drizzle repositories, Better Auth, external services) and `*.schema.ts` table definitions.
- `ui/` — React components for the web UI (epic E9).

Rules are enforced by `pnpm lint:boundaries` (`.dependency-cruiser.cjs`) and pinned by `tests/architecture/boundaries.test.ts`.
