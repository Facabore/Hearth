import { defineConfig } from "vitest/config";

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
          ],
          exclude: ["src/**/*.int.test.ts"],
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
