# Stack versions

Pinned on 2026-10-11 (HU-E0-01). Each entry was the latest stable release that day unless a note explains otherwise.

| Component | Version | Note |
|---|---|---|
| Node.js | 24.21.0 | Current LTS ("Krypton") in `.nvmrc`, Docker and CI; `engines` accepts `>=24.12.0 <25` for local hosts. Vitest 5 requires Node ≥ 22.12 |
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
| Test database | — | No Testcontainers: `tests/support/postgres-global-setup.ts` starts `postgres:18.6-alpine` through the Docker CLI (Testcontainers 12.2.0 would add ~64 KB of lockfile and dockerode/ssh2 to the supply chain). `TEST_DATABASE_URL` uses an existing disposable database instead |
| dependency-cruiser | 18.6.0 | Boundary gate (ADR 0001) |
| ESLint / @eslint/js | 10.12.0 / 10.0.1 | 9.39.5 is deprecated (no longer supported); eslint-config-next was dropped for the backend-first phase, so ESLint 10 is usable |
| typescript-eslint | 8.71.1 | Supports ESLint ^10 and TypeScript <6.1.0 |
| eslint-config-next | — | Deferred to the web UI (HU-E9-01); its React/import/jsx-a11y plugin tree is UI-only |
| Prettier | 3.9.10 | |
| uuid | 14.0.3 | UUIDv7 ids |
| next-intl | 4.14.9 | Pinned for E9; installed when the web UI starts |
| Playwright | 1.64.0 | Pinned for E9; installed when the web UI starts |
| Tailwind CSS | 4.3.3 | Pinned for E9; installed when the web UI starts |
| PostgreSQL | 18.6 (`postgres:18.6-alpine`) | Same image in dev, tests and production, and for the `backup` service, so `pg_dump` matches the server (its busybox `crond` runs the schedule) |
| Caddy | 2.11.7 (`caddy:2.11.7-alpine`) | Automatic TLS |
| rclone | 1.75.1 (`rclone/rclone:1.75.1`) | Pinned on 2026-10-19 (HU-E8-01), published 2026-09-04; 1.75.2 (2026-10-09, a security release) was under two weeks old, so the bump waits for 2026-10-23 (issue #135): the optional `backup-offsite` service (profile `offsite`) and its test |
