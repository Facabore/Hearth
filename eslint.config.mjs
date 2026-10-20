import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    "next-env.d.ts",
    "drizzle/**",
    "tests/architecture/fixtures/**",
    "src/shared/ui/api/schema.d.ts",
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly" },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    // HU-E9-*: the Rules of Hooks for components and hooks (ruling P136; eslint-config-next does not support ESLint 10).
    files: ["src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
  },
]);
