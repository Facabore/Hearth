import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * ADR 0006 (#199): the single-page app's script budgets, in KiB of gzip as Caddy serves them. Read from Vite's manifest:
 * - `shell`: the script every first visit loads (the entry and its static imports);
 * - each route and catalog that loads on demand: its own chunk and the static imports the shell does not already hold.
 * A missed budget is the owner's decision, never a silent raise (ADR 0004); a chunk without a budget fails too.
 */
export function chunkSizes(manifest, gzipKb) {
  const closure = (key, into = new Set()) => {
    const chunk = manifest[key];
    if (!chunk || into.has(chunk.file)) return into;
    into.add(chunk.file);
    for (const imported of chunk.imports ?? []) closure(imported, into);
    return into;
  };
  const sum = (files) =>
    [...files].filter((file) => file.endsWith(".js")).reduce((kb, file) => kb + gzipKb(file), 0);
  const [entry] = Object.entries(manifest).find(([, chunk]) => chunk.isEntry) ?? [];
  if (!entry) throw new Error("The manifest has no entry chunk");
  const shell = closure(entry);
  const sizes = { shell: sum(shell) };
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.isDynamicEntry) continue;
    sizes[key] = sum([...closure(key)].filter((file) => !shell.has(file)));
  }
  return sizes;
}

/** Every chunk over its budget or without one, as one line each; empty when all fit. */
export function overBudget(sizes, budgets) {
  return Object.entries(sizes).flatMap(([name, kb]) =>
    budgets[name] === undefined
      ? [`${name}: ${kb.toFixed(1)} KiB has no budget in tests/performance/spa-budgets.json`]
      : kb > budgets[name]
        ? [`${name}: ${kb.toFixed(1)} KiB is over its budget of ${budgets[name]} KiB`]
        : [],
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = "dist/spa";
  const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8"));
  const gzipKb = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024;
  const sizes = chunkSizes(manifest, gzipKb);
  const { scriptKb } = JSON.parse(readFileSync("tests/performance/spa-budgets.json", "utf8"));
  for (const [name, kb] of Object.entries(sizes))
    console.log(`${name.padEnd(36)} ${kb.toFixed(1)} KiB / ${scriptKb[name] ?? "?"}`);
  const failures = overBudget(sizes, scriptKb);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  console.log("Every SPA chunk is within its budget.");
}
