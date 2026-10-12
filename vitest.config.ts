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
          include: ["src/**/*.test.ts", "scripts/**/*.test.mjs", "tests/architecture/**/*.test.ts"],
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
    ],
  },
});
