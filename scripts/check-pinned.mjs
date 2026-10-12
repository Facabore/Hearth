import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Returns every dependency whose spec is not an exact semver version. */
export function findUnpinned(pkg) {
  const unpinned = [];
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!EXACT.test(spec)) unpinned.push({ field, name, spec });
    }
  }
  return unpinned;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? "package.json";
  const unpinned = findUnpinned(JSON.parse(readFileSync(file, "utf8")));
  if (unpinned.length > 0) {
    for (const { field, name, spec } of unpinned) {
      console.error(`${name} is not pinned to an exact version (${field}: "${spec}")`);
    }
    process.exit(1);
  }
  console.log("All dependencies are pinned to exact versions.");
}
