import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import compile from "icu-minify/compile";
import { defineConfig, type Plugin, type Rollup } from "vite";
import { THEME_BOOTSTRAP } from "./src/shared/ui/theme/theme";
import { API_URL, E2E_SPA_PORT } from "./e2e-ports";
import { catalogPreload, EARLY_READS } from "./src/spa/early-html";
import { chunkFiles, framePick, routeAreas, routePreload, routeTable } from "./src/spa/route-preload";

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

/** Every catalog the app loads: each language's core one and each area's (ruling P276), all compiled at build time. */
export const CATALOG_FILE = /[\\/]src[\\/]i18n[\\/]messages[\\/](?:areas[\\/][a-z]+\.)?[a-z]+\.json$/;

/** The core catalogs alone: the HTML preloads the likely language's core on every screen (`catalogPreload`). */
export const CORE_CATALOG_FILE = /[\\/]src[\\/]i18n[\\/]messages[\\/][a-z]+\.json$/;

/** An area's catalog in one language, `areas/<area>.<language>.json`: the HTML preloads the first screen's areas. */
export const AREA_CATALOG_FILE = /[\\/]src[\\/]i18n[\\/]messages[\\/]areas[\\/]([a-z]+)\.([a-z]+)\.json$/;

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
    if (!CATALOG_FILE.test(id)) return null;
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

/**
 * The profile and spaces reads start with the HTML, while the app's script downloads (`src/spa/early-html.ts`), and so does
 * the catalog every screen needs before it renders: only the likely language's, picked in the browser as the app picks
 * it (`catalogPreload`), with the area catalogs the first screen's loader waits for (ruling P276), so they are no
 * round trip of their own after the core's. Both scripts come first in the head, since an inline script after the
 * stylesheet waits for it.
 */
const earlyReads = (): Plugin => ({
  name: "hearth:early-reads",
  transformIndexHtml: {
    order: "post",
    handler: (html, { bundle }) => {
      const catalogs = Object.fromEntries(
        Object.values(bundle ?? {}).flatMap((file) => {
          if (file.type !== "chunk") return [];
          const id = file.moduleIds.find((one) => CORE_CATALOG_FILE.test(one));
          return id ? [[/([a-z]+)\.json$/.exec(id)![1]!, `/${file.fileName}`]] : [];
        }),
      );
      const areaFiles: Record<string, Record<string, string>> = {};
      for (const file of Object.values(bundle ?? {})) {
        if (file.type !== "chunk") continue;
        for (const id of file.moduleIds) {
          const [, area, language] = AREA_CATALOG_FILE.exec(id) ?? [];
          if (area && language) (areaFiles[area] ??= {})[language] = `/${file.fileName}`;
        }
      }
      return {
        html: bundle ? inlineStylesheet(html, bundle) : html,
        tags: [
          { tag: "script", children: framePick(routes()), injectTo: "head-prepend" },
          { tag: "script", children: EARLY_READS, injectTo: "head-prepend" },
          ...(Object.keys(catalogs).length > 0
            ? [
                {
                  tag: "script",
                  children: catalogPreload(catalogs, { files: areaFiles, routes: routeAreas(routes()) }),
                  injectTo: "head-prepend" as const,
                },
              ]
            : []),
          ...(bundle
            ? [{ tag: "script", children: firstScreen(bundle), injectTo: "head-prepend" as const }]
            : []),
        ],
      };
    },
  },
});

/**
 * The stylesheet goes inside the HTML, so the static frame paints as soon as the HTML arrives instead of after one
 * more round trip; index.html is read again on each visit anyway (Caddyfile.web), and the file stays for any other use.
 */
const inlineStylesheet = (html: string, bundle: Rollup.OutputBundle): string =>
  html.replace(/<link rel="stylesheet"[^>]*href="\/([^"]+\.css)"[^>]*>/g, (link, fileName: string) => {
    const asset = bundle[fileName];
    // A stylesheet never closes a style element, but a stray "</style" in it would end this one early.
    return asset?.type === "asset"
      ? `<style>${String(asset.source).replaceAll("</style", "<\\/style")}</style>`
      : link;
  });

/** The route table, read off routes.tsx at build time (`src/spa/route-preload.ts`). */
const routes = () => routeTable(readFileSync(from("./src/spa/routes.tsx"), "utf8"));

/**
 * The first screen's own chunks, its layout's and its loaders', preloaded beside the app's script
 * (`src/spa/route-preload.ts`): each module's chunk and the chunks it imports, without those the app's script loads.
 */
const firstScreen = (bundle: Rollup.OutputBundle): string =>
  routePreload(
    routes(),
    chunkFiles(Object.values(bundle).filter((file): file is Rollup.OutputChunk => file.type === "chunk")),
  );

/**
 * Ruling P280 (#201): the page's Content-Security-Policy. Scripts come only from the app's origin or are one of the
 * page's own inline scripts, each named by its sha256 hash, so the policy is computed from the built index.html. Styles
 * allow 'unsafe-inline' instead of hashes: the sheets' scroll lock (Radix, through react-style-singleton) adds a style
 * element at run time, and a hash in style-src would make browsers ignore 'unsafe-inline'.
 */
export const contentSecurityPolicy = (html: string): string => {
  const inline = [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    ([, code = ""]) => `'sha256-${createHash("sha256").update(code).digest("base64")}'`,
  );
  return [
    "default-src 'self'",
    ["script-src 'self'", ...new Set(inline)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
};

/** The policy as the Caddy directive `Caddyfile.web` imports; a policy never holds a double quote. */
export const cspHeader = (policy: string): string => `header Content-Security-Policy "${policy}"\n`;

/** Where the build writes that directive, outside the served files: the Dockerfile copies it next to the Caddyfile. */
const CSP_FILE = from("./dist/caddy/csp.caddy");

/**
 * The build writes the policy for the index.html it just wrote, and the preview, which the e2e specs open, sends the
 * same one, so the suite runs under the policy production sends.
 */
const securityPolicy = (): Plugin => ({
  name: "hearth:content-security-policy",
  writeBundle({ dir }) {
    const policy = contentSecurityPolicy(readFileSync(join(dir!, "index.html"), "utf8"));
    mkdirSync(dirname(CSP_FILE), { recursive: true });
    writeFileSync(CSP_FILE, cspHeader(policy));
  },
  configurePreviewServer(server) {
    const page = join(server.config.build.outDir, "index.html");
    // No build yet: Vite's preview says so itself.
    if (!existsSync(page)) return;
    // The preview reads index.html from disk on each request, so a build while it runs (`pnpm spa:build` by hand or
    // another agent's) serves a page whose inline scripts the policy of the old page refuses: the policy follows the
    // page, computed again when the file changes, and the last one stays while a build has emptied the folder.
    const read = () => ({
      mtimeMs: statSync(page).mtimeMs,
      header: contentSecurityPolicy(readFileSync(page, "utf8")),
    });
    let policy = read();
    const current = () => {
      try {
        if (statSync(page).mtimeMs !== policy.mtimeMs) policy = read();
      } catch {
        // Mid-build: no index.html for the moment.
      }
      return policy.header;
    };
    server.middlewares.use((_request, response, next) => {
      response.setHeader("Content-Security-Policy", current());
      next();
    });
  },
});

/** ADR 0006, epic #199: the client-first SPA, at the root since the cut-over; the API stays on the app. */
export default defineConfig({
  root: from("./src/spa"),
  base: "/",
  // The icons the HTML links to, served beside the build as files of their own.
  publicDir: from("./src/spa/public"),
  plugins: [precompiledCatalogs(), themeBootstrap(), earlyReads(), securityPolicy()],
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
    // The e2e front: the build at the root, /api/* from the e2e server, as Caddy routes it in production. Both ports
    // are the e2e's own rule (e2e-ports.ts), so the specs and this server never disagree.
    port: Number(E2E_SPA_PORT),
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "^/api(?:/|$)": {
        target: API_URL,
        // Same origin as in production: Better Auth checks the Origin of a sign-in against its own URL.
        headers: { origin: API_URL },
      },
    },
  },
});
