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
      to: { path: "^src/modules/(?!$1/)[^/]+/", pathNot: "^src/modules/[^/]+/application/index\\.ts$" },
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
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: ["^tests/architecture/fixtures/", "\\.test\\.(ts|mjs)$"] },
  },
};
