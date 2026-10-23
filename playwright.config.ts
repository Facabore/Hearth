import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { BASE_URL } from "./tests/e2e/support/base-url";

const bddDir = defineBddConfig({
  features: "tests/e2e/features/*.feature",
  steps: ["tests/e2e/steps/*.ts", "tests/e2e/support/fixtures.ts"],
  outputDir: "tests/e2e/.features-gen",
});

/** HU-E9-*: @e2e scenarios against the standalone build and a disposable PostgreSQL (ruling P132). */
export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  globalTeardown: "./tests/e2e/support/global-teardown.ts",
  use: { baseURL: BASE_URL, locale: "es-CO", timezoneId: "America/Bogota", trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${BASE_URL}/api/v1/health`,
    // A server already on the port may be another worktree's build: reuse it only when asked (E2E_REUSE=1).
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 180_000,
    // POSIX: lets scripts/e2e-server.mjs remove its database (Windows always force-kills: see globalTeardown).
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
  projects: [
    { name: "e2e", testDir: bddDir, use: { ...devices["Pixel 7"] } },
    {
      name: "a11y",
      testDir: "tests/e2e",
      testMatch: ["a11y*.spec.ts", "layout.spec.ts"],
      use: { ...devices["Pixel 7"] },
    },
    { name: "perf", testDir: "tests/e2e/perf", use: { ...devices["Pixel 7"] } },
  ],
});
