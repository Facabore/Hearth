# ADR 0004 — Web UI tests and performance gates

- Status: Accepted (2026-10-20)
- Stories: HU-E9-01, HU-E9-02, HU-E9-03, HU-E9-13 (rulings P132, P134)

## Context

The owner kept React and Next.js on one condition: the UI must be fast, with Core Web Vitals budgets that fail CI. The stories are written in Gherkin and the UI Definition of Done asks for accessibility in light and dark themes.

## Decision

- Components and containers run in a Vitest `ui` project on jsdom 30.1.2 with Testing Library and axe-core 4.13.0, contrast off (P132). jsdom over happy-dom: axe-core's ARIA and name computations are validated on jsdom, and Testing Library is mature on it.
- `@e2e` scenarios run with Playwright 1.63.0 and playwright-bdd 9.2.1 against the standalone build and a disposable PostgreSQL; `@axe-core/playwright` 4.13.0 scans every screen in light and dark in real Chromium, contrast included.
- Lighthouse 13.5.0's Node API measures each route five times with its mobile defaults and fails on the medians above LCP 2500 ms, CLS 0.1, TBT 200 ms or the route's script budget in `tests/performance/budgets.json`; a route without a budget fails (P134). `@lhci/cli` was not adopted: it has no hook for authenticated routes and a heavier dependency tree.
- The e2e server, its database container's label and every spec read `E2E_PORT` (default 3100), so two worktrees can run e2e at once, each against its own build; the teardown removes only its own port's containers, and a server already on the port is reused only with `E2E_REUSE=1` (#140).
- INP is measured with `web-vitals` 6.2.3 over the record flow on a 4× slower CPU, because a Lighthouse navigation run has no interaction to measure.
- The budgets are enforced on the standalone build, which compresses with gzip as Caddy does in production. Two code choices keep a route from paying for screens it does not show: `package.json` declares `sideEffects: ["**/*.css"]` (a route's client bundle then holds only the modules it uses, not every client component a barrel file re-exports), and `Sheet` imports its Radix Dialog panel on first open.

## Consequences

- A missed budget is the owner's decision, never a silent raise. The first measurement set the script budgets just above the measured bundles, because the framework alone is 129 KiB gzip (ruling P154).
- Lighthouse's simulated throttling varies on shared runners; medians of five reduce the noise, they do not remove it. Simulated LCP is bimodal on this app (it steps in about 150 ms and swings by a second between runs), so a median of three failed about one CI run in twenty with no code change; five runs cut that to under one in fifty (M6b Task 21, amending P134).
- The `performance` job blocks the image build.
