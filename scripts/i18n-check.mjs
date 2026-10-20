import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Codes the UI shows whatever the document says: the fallback and the server failure. */
const ALWAYS = ["InternalError", "Unknown"];

/**
 * Ruling P120: the error codes an operation can answer, read from its 4xx and 5xx descriptions ("AccountArchived,
 * SpaceArchived (…)"): parentheticals dropped, then every comma-separated PascalCase word; prose ("Not signed in") is not
 * a code.
 */
export const errorCodesOf = (openapi) => {
  const codes = new Set(ALWAYS);
  for (const operations of Object.values(openapi.paths ?? {}))
    for (const operation of Object.values(operations))
      for (const [status, response] of Object.entries(operation.responses ?? {}))
        if (Number(status) >= 400)
          for (const part of String(response.description ?? "")
            .replace(/\([^)]*\)/g, "")
            .split(","))
            if (/^[A-Z][A-Za-z]+$/.test(part.trim())) codes.add(part.trim());
  return [...codes].sort();
};

const leaves = (node, prefix = "") =>
  Object.entries(node ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === "object"
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );

/** Every problem with the two catalogs: a key missing in one, a leaf that is not a string, an error code without a message. */
export const checkCatalogs = ({ es, en, openapi }) => {
  const catalogs = { es: new Map(leaves(es)), en: new Map(leaves(en)) };
  const keys = new Set([
    ...catalogs.es.keys(),
    ...catalogs.en.keys(),
    ...errorCodesOf(openapi).map((c) => `errors.${c}`),
  ]);
  const problems = [];
  for (const key of [...keys].sort())
    for (const [name, catalog] of Object.entries(catalogs)) {
      const value = catalog.get(key);
      if (value === undefined) problems.push(`Missing in ${name}: ${key}`);
      else if (typeof value !== "string") problems.push(`Not a message in ${name}: ${key}`);
    }
  return problems;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const problems = checkCatalogs({
    es: read("src/i18n/messages/es.json"),
    en: read("src/i18n/messages/en.json"),
    openapi: read("openapi/openapi.snapshot.json"),
  });
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log("Both catalogs hold the same keys and every error code has a message.");
}
