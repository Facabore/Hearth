import { defineConfig } from "vitest/config";

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
    ],
  },
});
