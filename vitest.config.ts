import { defineConfig } from "vitest/config";
import { NEXT_ADAPTERS } from "./vite.spa.config";

const dbProject = {
  globalSetup: ["./tests/support/postgres-global-setup.ts"],
  testTimeout: 60_000,
  hookTimeout: 180_000,
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "scripts/**/*.test.mjs",
            "tests/architecture/**/*.test.ts",
            "tests/support/**/*.test.ts",
            "tests/performance/**/*.test.mjs",
          ],
          exclude: ["src/**/*.int.test.ts", "src/spa/**"],
        },
      },
      {
        // Components and containers (HU-E9-*): jsdom, Testing Library and axe-core (ruling P132).
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          exclude: ["src/spa/**"],
          // Radix sheets and user-event typing under jsdom slow down a lot on a loaded machine; 5 s timed out at random.
          testTimeout: 20_000,
          setupFiles: ["./tests/support/ui-setup.ts", "./src/shared/ui/molecules/sheet.setup.ts"],
        },
      },
      {
        // ADR 0006: the SPA's routes, guards and query hooks, with the components' Next.js imports on its adapters.
        extends: true,
        resolve: { alias: NEXT_ADAPTERS },
        test: {
          name: "spa",
          environment: "jsdom",
          include: ["src/spa/**/*.test.{ts,tsx}"],
          testTimeout: 20_000,
          setupFiles: ["./tests/support/ui-setup.ts", "./src/shared/ui/molecules/sheet.setup.ts"],
        },
      },
      { test: { name: "integration", include: ["src/**/*.int.test.ts"], ...dbProject } },
      {
        test: {
          name: "acceptance",
          include: ["tests/acceptance/**/*.test.ts"],
          fileParallelism: false,
          ...dbProject,
        },
      },
      {
        // Runs the backup scripts in disposable containers through the Docker CLI (tests/support/backup-stack.ts).
        test: {
          name: "operations",
          include: ["tests/operations/**/*.test.ts"],
          setupFiles: ["./tests/support/backup-stack-teardown.ts"],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
