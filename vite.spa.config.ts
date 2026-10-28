import { fileURLToPath } from "node:url";
import compile from "icu-minify/compile";
import { defineConfig, type Plugin } from "vite";
import { THEME_BOOTSTRAP } from "./src/shared/ui/theme/theme";

const from = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * ADR 0006: the components move as they are. Their Next.js imports resolve to the SPA's adapters over TanStack Router
 * and use-intl, so a screen moves without touching a line; exact matches only, so nothing server-side slips in.
 */
export const NEXT_ADAPTERS = [
  { find: /^next\/link$/, replacement: from("./src/spa/next/link.tsx") },
  { find: /^next\/navigation$/, replacement: from("./src/spa/next/navigation.ts") },
  { find: /^next\/dynamic$/, replacement: from("./src/spa/next/dynamic.tsx") },
  { find: /^next-intl$/, replacement: from("./src/spa/next/intl.ts") },
  // A component's default client is the app's own, with its writes planned over the query cache (slice 2 of #199).
  { find: /^@\/shared\/ui\/api\/client$/, replacement: from("./src/spa/next/api-client.ts") },
];

type Catalog = { [key: string]: string | Catalog };
const precompiled = (catalog: Catalog): unknown =>
  Object.fromEntries(
    Object.entries(catalog).map(([key, value]) => [
      key,
      typeof value === "string" ? compile(value) : precompiled(value),
    ]),
  );

/**
 * Ruling P134 as next.config.ts applies it: the catalogs are compiled at build time, so the client ships use-intl's
 * small formatter and not the ICU parser.
 */
const precompiledCatalogs = (): Plugin => ({
  name: "hearth:precompiled-catalogs",
  enforce: "pre",
  transform(source, id) {
    if (!/[\\/]src[\\/]i18n[\\/]messages[\\/][a-z]+\.json$/.test(id)) return null;
    const catalog = JSON.parse(source) as Catalog;
    // Still JSON: Vite turns it into a module afterwards, as it does any catalog.
    return { code: JSON.stringify(precompiled(catalog)), map: null };
  },
});

/** The stored theme is applied before the first paint, as the Next.js root layout's inline script does. */
const themeBootstrap = (): Plugin => ({
  name: "hearth:theme-bootstrap",
  transformIndexHtml: () => [{ tag: "script", children: THEME_BOOTSTRAP, injectTo: "head-prepend" }],
});

/** ADR 0006, epic #199: the client-first SPA, at the root since the cut-over; the API stays on the app. */
export default defineConfig({
  root: from("./src/spa"),
  base: "/",
  // The icons the HTML links to, served beside the build as files of their own.
  publicDir: from("./src/spa/public"),
  plugins: [precompiledCatalogs(), themeBootstrap()],
  resolve: {
    tsconfigPaths: true,
    alias: [
      ...NEXT_ADAPTERS,
      { find: /^use-intl\/format-message$/, replacement: "use-intl/format-message/format-only" },
    ],
  },
  build: {
    outDir: from("./dist/spa"),
    emptyOutDir: true,
    manifest: true,
    // The budgets read the gzip sizes themselves (scripts/spa-budget.mjs).
    reportCompressedSize: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // The app shell's libraries in one file: split across the screens that share them, they became a dozen
              // small chunks that each compress on their own, 5 KiB more gzip for the same code (slice 2 of #199).
              name: "framework",
              // Only the shell's own: the parts only the screens and the saves use (several queries at once, mutations)
              // stay with them (slice 5 of #199).
              test: (id: string) =>
                /[\\/]node_modules[\\/](react|react-dom|scheduler|@tanstack|openapi-fetch|use-intl|@formatjs)[\\/]/.test(
                  id,
                ) && !/[\\/](queriesObserver|useQueries|useSuspenseQueries|mutationObserver)\.js$/.test(id),
            },
          ],
        },
      },
      // The shared components and Radix carry Next.js's "use client"; a client-only bundle has nothing to keep it for.
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
  },
  preview: {
    // The e2e front: the build at the root, /api/* from the e2e server, as Caddy routes it in production.
    port: Number(process.env.E2E_SPA_PORT ?? Number(process.env.E2E_PORT ?? 3100) + 100),
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "^/api(?:/|$)": {
        target: `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`,
        // Same origin as in production: Better Auth checks the Origin of a sign-in against its own URL.
        headers: { origin: `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}` },
      },
    },
  },
});
