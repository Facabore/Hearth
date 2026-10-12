# ADR 0002 — Generate OpenAPI 3.1 with zod-openapi

- Status: Accepted (2026-10-12)
- Story: HU-E0-09

## Context

Contracts are Zod 4 schemas per module. Candidates: zod-openapi 6.0.2 and @asteasolutions/zod-to-openapi 9.1.0.

## Decision

Use zod-openapi 6.0.2. It builds on Zod 4's native metadata without patching Zod's prototype, and documents are plain objects composed from per-module path fragments.

## Consequences

- Each module exports `ZodOpenApiPathsObject` fragments from `contracts/`; `src/composition/openapi.ts` merges them and `GET /api/v1/openapi.json` serves the result.
- zod-openapi 6 types target OAS 3.2; we emit `openapi: "3.1.0"` with a cast. Revisit when clients support 3.2.
- `openapi/openapi.snapshot.json` is the reviewed contract. `src/composition/openapi.test.ts` fails on any unintended change and names each changed operation (`GET /api/v1/me`); regenerate deliberately with `UPDATE_OPENAPI_SNAPSHOT=1 pnpm vitest run --project unit src/composition/openapi.test.ts`.
