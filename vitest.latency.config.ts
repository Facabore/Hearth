import { defineConfig } from "vitest/config";

/**
 * Ruling P249's addendum: the wall-clock report latency probe (issue #128), run by hand with `pnpm perf:reports`.
 * It is not a test of the suite (`pnpm test` never runs it) and asserts no time, so the no-clock test rule holds.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "latency",
    include: ["tests/performance/report-latency.bench.ts"],
    // Verbose, so the results table the probe prints is shown for a passing run.
    reporters: ["verbose"],
    globalSetup: ["./tests/support/postgres-global-setup.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
