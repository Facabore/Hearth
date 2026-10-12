import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Schema drift gate: generate into a scratch copy of drizzle/ and fail if a new migration appears.
// Fails closed: drizzle-kit can exit 0 after an internal error, so only its explicit
// "No schema changes" report counts as a pass.
const drizzleKitBin = join(dirname(createRequire(import.meta.url).resolve("drizzle-kit")), "bin.cjs");
// Relative on purpose: drizzle-kit resolves `out` against the working directory, even when absolute.
mkdirSync(join("node_modules", ".cache"), { recursive: true });
const out = mkdtempSync(join("node_modules", ".cache", "hearth-db-check-"));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let generate;
let added;
try {
  cpSync("drizzle", out, { recursive: true });
  const before = new Set(readdirSync(out).filter((f) => f.endsWith(".sql")));
  generate = spawnSync(process.execPath, [drizzleKitBin, "generate"], {
    encoding: "utf8",
    env: { ...process.env, DRIZZLE_OUT: out },
  });
  added = readdirSync(out).filter((f) => f.endsWith(".sql") && !before.has(f));
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (added.length > 0) {
  fail(
    `Schema drift: a migration is missing (drizzle-kit would generate ${added.join(", ")}). Run "pnpm db:generate".`,
  );
}
if (generate.status !== 0 || !generate.stdout.includes("No schema changes")) {
  fail(`db:check could not verify the schema; drizzle-kit output:\n${generate.stdout}${generate.stderr}`);
}
console.log("No schema drift: migrations match the Drizzle schema.");
