/**
 * The e2e server's port. `E2E_PORT` lets two worktrees run their e2e at once, each against its own build: the
 * server, its database container's label and every spec read the same port.
 */
export const E2E_PORT = process.env.E2E_PORT ?? "3100";
/** The e2e server itself: Next.js serving only `/api` (ADR 0006). Specs reach it through the front below. */
export const API_URL = `http://127.0.0.1:${E2E_PORT}`;
/**
 * ADR 0006 (#199): the front every spec opens, Vite's preview of the single-page app's build. It serves the app at the
 * root and proxies /api/* to the e2e server, as Caddy routes it in production; 100 above `E2E_PORT` unless named.
 */
export const E2E_SPA_PORT = process.env.E2E_SPA_PORT ?? String(Number(E2E_PORT) + 100);
export const BASE_URL = `http://127.0.0.1:${E2E_SPA_PORT}`;
/** The label of this run's database container: the teardown removes only its own run's containers. */
export const RUN_LABEL = `hearth.test.e2e.port=${E2E_PORT}`;
