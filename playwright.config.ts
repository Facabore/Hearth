import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { API_URL, BASE_URL, E2E_PORT, E2E_SPA_PORT } from "./tests/e2e/support/base-url";

/**
 * Once, in the runner (its workers inherit E2E_RUNNER_PID): CI and the image run the Node of .nvmrc, a laptop may not.
 * Windows builds of Node 24 before 24.16 can die without a word (exit 0xC0000409, nodejs/node#63620): a worker or a
 * web server vanishes mid-run, and every test after it fails in milliseconds with ECONNREFUSED.
 */
const pinnedNode = readFileSync(new URL(".nvmrc", import.meta.url), "utf8").trim();
if (!process.env.E2E_RUNNER_PID && process.versions.node !== pinnedNode) {
  console.warn(`The e2e run on Node ${process.versions.node}; CI and the image run ${pinnedNode} (.nvmrc).`);
}

/**
 * This run's owner: the runner's pid labels the database container scripts/e2e-server.mjs starts for it, so the
 * teardown never removes the database of another run on the same port (one this run reused with E2E_REUSE=1). The
 * runner sets it before it forks its workers and starts the web servers, which inherit it.
 */
process.env.E2E_RUNNER_PID ??= String(process.pid);

const bddDir = defineBddConfig({
  features: "tests/e2e/features/*.feature",
  steps: ["tests/e2e/steps/*.ts", "tests/e2e/support/fixtures.ts"],
  outputDir: "tests/e2e/.features-gen",
});

/**
 * HU-E9-*: @e2e scenarios against the single-page app's build in front of the standalone API and a disposable
 * PostgreSQL (ruling P132, ADR 0006).
 */
export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  globalTeardown: "./tests/e2e/support/global-teardown.ts",
  use: { baseURL: BASE_URL, locale: "es-CO", timezoneId: "America/Bogota", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node scripts/e2e-server.mjs",
      url: `${API_URL}/api/v1/health`,
      // A server already on the port may be another worktree's build: reuse it only when asked (E2E_REUSE=1).
      reuseExistingServer: process.env.E2E_REUSE === "1",
      timeout: 180_000,
      // POSIX: lets scripts/e2e-server.mjs remove its database (Windows always force-kills: see globalTeardown).
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      // ADR 0006 (#199): the SPA's build (`pnpm spa:build`) at the root, /api/* proxied to the server above, like Caddy.
      // Every project below opens this front (BASE_URL), so it starts for all of them: run `pnpm spa:build` first.
      command: "pnpm exec vite preview --config vite.spa.config.ts",
      url: `${BASE_URL}/`,
      // The preview reads its port and its proxy target from tests/e2e/support/base-url.ts as well.
      env: { E2E_PORT, E2E_SPA_PORT },
      reuseExistingServer: process.env.E2E_REUSE === "1",
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "e2e", testDir: bddDir, use: { ...devices["Pixel 7"] } },
    {
      name: "a11y",
      testDir: "tests/e2e",
      testMatch: ["a11y*.spec.ts", "layout.spec.ts"],
      use: { ...devices["Pixel 7"] },
    },
    { name: "perf", testDir: "tests/e2e/perf", use: { ...devices["Pixel 7"] } },
    { name: "spa", testDir: "tests/e2e/spa", use: { ...devices["Pixel 7"] } },
  ],
});
