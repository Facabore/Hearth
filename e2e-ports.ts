/**
 * The e2e's ports, at the root so the image's build can read them: `vite.spa.config.ts` takes its preview port and
 * proxy target from here, and the image's build context leaves `tests/` out (.dockerignore). The specs read them through
 * `tests/e2e/support/base-url.ts`.
 *
 * `E2E_PORT` lets two worktrees run their e2e at once, each against its own build: the server, its database
 * container's label and every spec read the same port.
 */
export const E2E_PORT = process.env.E2E_PORT ?? "3100";
/** The e2e server itself: Next.js serving only `/api` (ADR 0006). Specs reach it through the front below. */
export const API_URL = `http://127.0.0.1:${E2E_PORT}`;
/**
 * ADR 0006 (#199): the front every spec opens, Vite's preview of the single-page app's build. It serves the app at the
 * root and proxies /api/* to the e2e server, as Caddy routes it in production; 100 above `E2E_PORT` unless named.
 */
export const E2E_SPA_PORT = process.env.E2E_SPA_PORT ?? String(Number(E2E_PORT) + 100);
