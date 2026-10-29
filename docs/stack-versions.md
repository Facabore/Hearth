# Stack versions

Pinned on 2026-10-11 (HU-E0-01). Each entry was the latest stable release that day unless a note explains otherwise.

| Component | Version | Note |
|---|---|---|
| Node.js | 24.21.0 | Current LTS ("Krypton") in `.nvmrc`, Docker and CI; `engines` accepts `>=24.12.0 <25` for local hosts. Vitest 5 requires Node ≥ 22.12 |
| pnpm | 12.11.2 | `packageManager` field; settings in `pnpm-workspace.yaml` |
| Next.js | 16.4.2 | App Router, standalone output; since #199 (2026-10-28) it serves only the API (`src/app/api/**`), and the screens are the SPA's; 16.4.2 (2026-10-22, #160) fixes GHSA-2464-fhr4-w9xw (critical, Image Optimization API with SVG) and GHSA-p3m5-59mp-jv5r (high, Server Actions DoS), both affecting 16.0.0 to 16.4.0 |
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
| eslint-config-next | — | Not adopted: its plugins do not support ESLint 10 (ruling P136); eslint-plugin-react-hooks 7.1.1 instead |
| Prettier | 3.9.10 | |
| uuid | 14.0.3 | UUIDv7 ids |
| next-intl | 4.14.9 | M6a (2026-10-02): the `es` and `en` texts (ruling P120). Since #199 the components import it by name and the SPA resolves it to use-intl; the jsdom tests render through its provider |
| Tailwind CSS / @tailwindcss/postcss | 4.3.3 / 4.3.3 | M6a (2026-07-16) |
| radix-ui | 1.7.0 | M6a (2026-10-05), exactly two weeks before the pin date: the primitives under the shadcn/ui-style components |
| class-variance-authority | 0.7.1 | M6a (2024-11-26): component variants |
| clsx | 2.1.1 | M6a (2024-04-23): joins class names |
| openapi-fetch | 0.17.0 | M6a (2026-02-11): the generated client at run time (ADR 0003) |
| openapi-typescript | 7.13.0 | M6a (2026-02-11): the client's types, generated from the snapshot (ADR 0003); its TypeScript peer is ^5 while Hearth uses 6.0.3 |
| eslint-plugin-react-hooks | 7.1.1 | M6a (2026-04-17): the hooks rules (ruling P136) |
| jsdom | 30.1.2 | M6a (2026-10-04): the `ui` test project (ruling P132); it needs Node ≥ 24.15 |
| @testing-library/react / dom / user-event / jest-dom | 16.3.3 / 10.4.2 / 14.6.7 / 7.0.1 | M6a (2026-08-27 / 2026-09-13 / 2026-09-02 / 2026-08-09) |
| axe-core / @axe-core/playwright | 4.13.0 / 4.13.0 | M6a (2026-08-05 / 2026-08-11): accessibility scans in jsdom and in Chromium |
| Playwright (@playwright/test) | 1.63.0 | M6a (2026-09-04); 1.64.0 (2026-10-07) was under two weeks old when M6a was planned (follow-up 4 of the plan) |
| playwright-bdd | 9.2.1 | M6a (2026-09-06): the `@e2e` scenarios |
| lighthouse | 13.5.0 | M6a (2026-09-18): the performance gates (ADR 0004) |
| web-vitals | 6.2.3 | M6a (2026-10-05): INP over the record flow (ADR 0004) |
| recharts | 3.10.1 | M6c (2026-07-25), the newest stable on or before the pin date 2026-10-07 (the 3.11 line was a canary until 2026-10-13): draws only the two time series (the personal and line trends) in `src/modules/reporting/ui/charts/`, behind a dynamic `import()` so no other route ships it (rulings P202, P203). Its ranges (`@reduxjs/toolkit`, `immer`, `reselect`, `es-toolkit`, `victory-vendor`, `decimal.js-light`) are fixed by the lockfile. Rejected: Recharts 2.15.x (maintenance line), Victory and Chart.js |
| react-is | 19.3.0 | M6c (2026-09-09): Recharts' peer. It is pinned because `check:pinned` allows no implicit peer, and because without a direct pin pnpm resolves the peer to the 17.0.2 that `pretty-format` brings, whose `isFragment` does not recognise React 19 elements |
| @tanstack/react-router | 1.170.44 | #199 slice 1 (2026-10-12), the newest on or before the pin date 2026-10-27 minus two weeks: the SPA's typed routes, search params and `beforeLoad` guards (ADR 0006). It pins `@tanstack/router-core` 1.171.37 and `@tanstack/history` 1.162.5 exactly; `@tanstack/react-store` and `isbot` are fixed by the lockfile |
| @tanstack/react-query | 5.104.2 | #199 slice 1 (2026-10-11): the SPA's server state (ADR 0006); it pins `@tanstack/query-core` 5.104.2 |
| use-intl | 4.14.9 | #199 slice 1 (2026-10-02), the version next-intl 4.14.9 already brings: the SPA's texts over the same catalogs (ADR 0006) |
| icu-minify | 4.14.9 | #199 slice 1 (2026-10-02), next-intl's own compiler: `vite.spa.config.ts` compiles the catalogs at build time as `next.config.ts` does (ruling P134), so the SPA ships use-intl's formatter without the ICU parser |
| Vite (SPA build) | 8.3.4 | Already pinned for Vitest; #199 slice 1 also builds the SPA with it (`vite.spa.config.ts`, no `@vitejs/plugin-react`: Vite's own transform compiles the JSX) |
| PostgreSQL | 18.6 (`postgres:18.6-alpine`) | Same image in dev, tests and production, and for the `backup` service, so `pg_dump` matches the server (its busybox `crond` runs the schedule) |
| Caddy | 2.11.7 (`caddy:2.11.7-alpine`) | Automatic TLS |
| rclone | 1.75.2 (`rclone/rclone:1.75.2`) | Pinned on 2026-10-25 (issue #135), published 2026-10-09: a security release (the b2 token and SSE-C key leaked on redirects, Go `net/http` and `crypto/tls` CVEs). It replaced 1.75.1, pinned on 2026-10-19 (HU-E8-01) while 1.75.2 was under two weeks old: the optional `backup-offsite` service (profile `offsite`) and its test |
