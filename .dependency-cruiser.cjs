/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-must-be-pure",
      severity: "error",
      comment:
        "Domain code may only import its own module's domain and src/shared/kernel: no frameworks, ORM, I/O, Node built-ins or outer layers.",
      from: { path: "^src/modules/([^/]+)/domain/" },
      to: { pathNot: ["^src/modules/$1/domain/", "^src/shared/kernel/"] },
    },
    {
      name: "kernel-must-be-pure",
      severity: "error",
      comment: "The shared kernel is pure TypeScript and imports nothing outside itself.",
      from: { path: "^src/shared/kernel/" },
      to: { pathNot: "^src/shared/kernel/" },
    },
    {
      name: "application-must-not-depend-on-adapters",
      severity: "error",
      comment:
        "Application code depends on its domain, the shared kernel and other modules' public application API; never on infrastructure, contracts, ui, app, composition, the HTTP layer, frameworks or the ORM.",
      from: { path: "^src/modules/[^/]+/application/" },
      to: {
        path: [
          "^src/modules/[^/]+/(infrastructure|contracts|ui)/",
          "^src/(app|composition)/",
          "^src/shared/(http|infrastructure)/",
          "node_modules/(next|react|react-dom|drizzle-orm|pg|better-auth|@better-auth)/",
        ],
      },
    },
    {
      name: "modules-only-through-public-application-api",
      severity: "error",
      comment:
        "Modules may only import another module's public application API (src/modules/<module>/application/index.ts).",
      from: { path: "^src/modules/([^/]+)/", pathNot: "\\.schema\\.ts$" },
      to: {
        path: "^src/modules/(?!$1/)[^/]+/",
        pathNot: ["^src/modules/[^/]+/application/index\\.ts$", "^src/modules/[^/]+/ui/(index|server)\\.ts$"],
      },
    },
    {
      name: "schemas-only-reference-schemas",
      severity: "error",
      comment:
        "A *.schema.ts file may reference another module's *.schema.ts (foreign keys) and nothing else of that module.",
      from: { path: "^src/modules/([^/]+)/infrastructure/[^/]+\\.schema\\.ts$" },
      to: { path: "^src/modules/(?!$1/)[^/]+/", pathNot: "\\.schema\\.ts$" },
    },
    {
      name: "shared-must-not-depend-on-modules",
      severity: "error",
      comment: "Shared code never imports modules, the app or the composition root.",
      from: { path: "^src/shared/" },
      to: { path: "^src/(modules|app|composition)/" },
    },
    {
      name: "ui-talks-only-to-the-api",
      severity: "error",
      comment:
        "Ruling P119: the web pages, the proxy, i18n and every ui folder reach the backend only over /api/v1 through the generated client: never a module's domain, application, infrastructure or contracts, the composition root, the API routes, the HTTP or infrastructure layers or server-only packages; of the kernel only time-zone.ts, local-date.ts, style.ts and line-state.ts (ruling P244: the record form applies the API's own line levels).",
      from: {
        path: [
          "^src/app/\\(web\\)/",
          "^src/i18n/",
          "^src/proxy\\.ts$",
          "^src/shared/ui/",
          "^src/modules/[^/]+/ui/",
        ],
      },
      to: {
        path: [
          "^src/modules/[^/]+/(domain|application|infrastructure|contracts)/",
          "^src/composition/",
          "^src/app/api/",
          "^src/shared/(http|infrastructure)/",
          "^src/shared/kernel/(?!(time-zone|local-date|style|line-state)\\.ts$)",
          "node_modules/(drizzle-orm|pg|better-auth|@better-auth|zod-openapi|zod)/",
        ],
      },
    },
    {
      name: "ui-modules-only-through-public-ui-api",
      severity: "error",
      comment:
        "A module's ui reaches another module's ui only through src/modules/<module>/ui/index.ts (client-safe) or ui/server.ts (server containers), and the web pages reach every module only through them.",
      from: { path: ["^src/modules/([^/]+)/ui/", "^src/app/\\(web\\)/"] },
      to: {
        path: "^src/modules/[^/]+/ui/",
        pathNot: ["^src/modules/[^/]+/ui/(index|server)\\.ts$", "^src/modules/$1/ui/"],
      },
    },
    {
      name: "ui-index-is-client-safe",
      severity: "error",
      comment:
        "Ruling P153: a module's ui/index.ts is imported by client code, so it must never reach the server-only API reader (next/headers); server containers are exported from ui/server.ts.",
      from: { path: "^src/modules/[^/]+/ui/index\\.ts$" },
      to: { path: "^src/shared/ui/api/server\\.ts$", reachable: true },
    },
    {
      name: "only-ui-reaches-ui",
      severity: "error",
      comment:
        "Server layers never import a ui folder: the UI depends on the API, never the other way round.",
      from: { path: "^src/modules/[^/]+/(domain|application|infrastructure|contracts)/" },
      to: { path: "^src/modules/[^/]+/ui/" },
    },
    {
      name: "recharts-only-in-charts",
      severity: "error",
      comment:
        "Ruling P202 (M6c): Recharts is imported only by src/modules/reporting/ui/charts/*-chart.tsx, the files the lazy chart wrapper (lazy-*-chart.tsx) loads with import().",
      from: { pathNot: "^src/modules/reporting/ui/charts/(?!lazy-)[^/]+-chart\\.tsx$" },
      to: { path: "node_modules/recharts/" },
    },
    {
      name: "charts-load-lazily",
      severity: "error",
      comment:
        "Ruling P202 (M6c): a chart file is reached only through a dynamic import(), so a route without a chart never ships Recharts. The lazy wrapper (lazy-*-chart.tsx) is the one chart-named file pages import statically.",
      from: {},
      to: { path: "^src/modules/reporting/ui/charts/(?!lazy-)[^/]+-chart\\.tsx$", dynamic: false },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: ["^tests/architecture/fixtures/", "\\.test\\.(ts|tsx|mjs)$"] },
  },
};
