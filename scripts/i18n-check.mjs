import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
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

/**
 * Ruling P170: the warning codes a response can carry: every `warnings` array property whose items have a `code` enum,
 * anywhere in the document (RecordedExpense's FundBalanceNegative today).
 */
export const warningCodesOf = (openapi) => {
  const codes = new Set();
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    const warnings = node.properties?.warnings?.items?.properties?.code?.enum;
    if (Array.isArray(warnings)) for (const code of warnings) codes.add(code);
    for (const value of Object.values(node)) visit(value);
  };
  visit(openapi);
  return [...codes].sort();
};

const leaves = (node, prefix = "") =>
  Object.entries(node ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === "object"
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );

/** Every problem with the two catalogs: a key missing in one, a leaf that is not a string, an error or warning code without a message. */
export const checkCatalogs = ({ es, en, openapi }) => {
  const catalogs = { es: new Map(leaves(es)), en: new Map(leaves(en)) };
  const keys = new Set([
    ...catalogs.es.keys(),
    ...catalogs.en.keys(),
    ...errorCodesOf(openapi).map((c) => `errors.${c}`),
    ...warningCodesOf(openapi).map((c) => `warnings.${c}`),
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

/**
 * Ruling P276: the catalog is a core file per language plus area files (`areas/<area>.<locale>.json`) that load with
 * their routes. Every file holds the same keys in es and en, a key lives in one file only, and every error and warning
 * code has its message wherever it lives.
 */
export const checkCatalogFiles = ({ files, openapi }) => {
  const problems = [];
  const owner = new Map();
  const merged = { es: new Map(), en: new Map() };
  for (const { name, es, en } of files) {
    const catalogs = { es: new Map(leaves(es)), en: new Map(leaves(en)) };
    for (const key of [...new Set([...catalogs.es.keys(), ...catalogs.en.keys()])].sort()) {
      for (const [locale, catalog] of Object.entries(catalogs)) {
        const value = catalog.get(key);
        if (value === undefined) problems.push(`Missing in ${name}.${locale}: ${key}`);
        else if (typeof value !== "string") problems.push(`Not a message in ${name}.${locale}: ${key}`);
        else merged[locale].set(key, value);
      }
      if (owner.has(key)) problems.push(`In two files, ${owner.get(key)} and ${name}: ${key}`);
      else owner.set(key, name);
    }
  }
  const codes = [
    ...errorCodesOf(openapi).map((c) => `errors.${c}`),
    ...warningCodesOf(openapi).map((c) => `warnings.${c}`),
  ];
  for (const key of codes.sort())
    for (const [locale, catalog] of Object.entries(merged))
      if (!catalog.has(key)) problems.push(`Missing in ${locale}: ${key}`);
  return problems;
};

/**
 * The source with its comments and the text of its strings blanked to spaces, so a search over it meets only code;
 * offsets stay the same, and a template's `${…}` stays code.
 */
const blank = (source) => {
  const out = [...source];
  const wipe = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  const stack = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (stack.at(-1) === "`") {
      if (c === "\\") {
        wipe(i, i + 2);
        i += 2;
      } else if (c === "`") {
        stack.pop();
        i += 1;
      } else if (c === "$" && source[i + 1] === "{") {
        stack.push("{");
        i += 2;
      } else {
        wipe(i, i + 1);
        i += 1;
      }
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      wipe(i, stop);
      i = stop;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2) + 2;
      wipe(i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      wipe(i + 1, j);
      i = j + 1;
    } else if (c === "`") {
      stack.push("`");
      i += 1;
    } else {
      if (c === "{") stack.push("{");
      else if (c === "}" && stack.at(-1) === "{") stack.pop();
      i += 1;
    }
  }
  return out.join("");
};

const OPENERS = "([{";
const CLOSERS = ")]}";

/** The argument that starts at `open`: up to the bracket that closes its call, or to a comma at its own depth. */
const argumentAt = (code, source, open) => {
  let depth = 0;
  let i = open;
  for (; i < code.length; i += 1) {
    const c = code[i];
    if (OPENERS.includes(c)) depth += 1;
    else if (CLOSERS.includes(c)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === "," && depth === 0) break;
  }
  return { text: source.slice(open, i), code: code.slice(open, i), end: i };
};

const isTernary = (code, i) =>
  code[i] === "?" && code[i + 1] !== "." && code[i + 1] !== "?" && code[i - 1] !== "?";

/** `cond ? a : b` at its own depth, as the two branches' text and code; null when it is not a conditional. */
const branchesOf = (code, text) => {
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (OPENERS.includes(c)) depth += 1;
    else if (CLOSERS.includes(c)) depth -= 1;
    else if (depth === 0 && isTernary(code, i)) {
      let inner = 0;
      let nested = 0;
      for (let j = i + 1; j < code.length; j += 1) {
        const d = code[j];
        if (OPENERS.includes(d)) inner += 1;
        else if (CLOSERS.includes(d)) inner -= 1;
        else if (inner === 0 && isTernary(code, j)) nested += 1;
        else if (d === ":" && inner === 0) {
          if (nested === 0)
            return [text.slice(i + 1, j), code.slice(i + 1, j), text.slice(j + 1), code.slice(j + 1)];
          nested -= 1;
        }
      }
      return null;
    }
  }
  return null;
};

/**
 * The keys a translator's key argument may name, relative to its namespace, as `{ path, prefix }`: a prefix for a
 * template (`type.${t}` reads every `type.` key). Null when the reading cannot pin the argument down.
 */
const keysOfArgument = (text, code) => {
  const trimmed = text.trim();
  const literal = /^"([^"]*)"$|^'([^']*)'$|^`([^`$]*)`$/.exec(trimmed);
  if (literal) return [{ path: literal[1] ?? literal[2] ?? literal[3], prefix: false }];
  const template = /^`([^`$]*)\$\{/.exec(trimmed);
  if (template) return [{ path: template[1], prefix: true }];
  const offset = text.indexOf(trimmed);
  const cast = /^([\s\S]*?)\s+as\s+[\w".|\s]+$/.exec(trimmed);
  if (cast) return keysOfArgument(cast[1], code.slice(offset, offset + cast[1].length));
  const branches = branchesOf(code, text);
  if (!branches) return null;
  const [yesText, yesCode, noText, noCode] = branches;
  const yes = keysOfArgument(yesText, yesCode);
  const no = keysOfArgument(noText, noCode);
  return yes && no ? [...yes, ...no] : null;
};

/** A declared function: `const name = (…) =>` or `function name(…)`; its parameters' names and its body's span. */
const declarationOf = (code, name) => {
  const match = new RegExp(
    `(?:const|function)\\s+${name}\\s*(?:=\\s*(?:async\\s*)?)?(?:<[^>]*>)?\\s*\\(`,
  ).exec(code);
  if (!match) return null;
  // The parameters, split at their own depth: a type's `<…>` counts as a bracket there, an arrow's `=>` does not.
  const params = [];
  let at = match.index + match[0].length;
  let start = at;
  for (let depth = 0; at < code.length; at += 1) {
    const c = code[at];
    if (OPENERS.includes(c) || c === "<") depth += 1;
    else if (CLOSERS.includes(c) || (c === ">" && code[at - 1] !== "=")) {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === "," && depth === 0) {
      params.push(/^\s*(\w+)/.exec(code.slice(start, at))?.[1] ?? null);
      start = at + 1;
    }
  }
  params.push(/^\s*(\w+)/.exec(code.slice(start, at))?.[1] ?? null);
  // The body runs to the end of the declaration's statement: a `;` or a closing brace at its own depth.
  let depth = 0;
  let end = at + 1;
  for (; end < code.length; end += 1) {
    const c = code[end];
    if (OPENERS.includes(c)) depth += 1;
    else if (CLOSERS.includes(c)) {
      if (depth === 0) break;
      depth -= 1;
      if (depth === 0 && c === "}" && /^\s*\n/.test(code.slice(end + 1, end + 3))) break;
    } else if (c === ";" && depth === 0) break;
  }
  return { params, body: [at, end] };
};

const WHOLE = [{ path: "", prefix: true }];

/** The call `code[at]` is an argument of: the called function's name and the argument's position. */
const enclosingCall = (code, at) => {
  let depth = 0;
  let commas = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const c = code[i];
    if (CLOSERS.includes(c)) depth += 1;
    else if (c === "[" || c === "{") {
      if (depth === 0) return null;
      depth -= 1;
    } else if (c === "(") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const name = /(\w+)\s*$/.exec(code.slice(0, i))?.[1];
      return name ? { name, index: commas } : null;
    } else if (c === "," && depth === 0) commas += 1;
    else if (c === ";" && depth === 0) return null;
  }
  return null;
};

/**
 * Every use of the translator `name` in `code[from, to)`: the keys it reads, relative to its namespace. A call reads
 * its key argument; a translator handed to a function reads what `handedTo` says that function reads with it; any
 * other use reads the whole namespace.
 */
const usesOf = (name, code, source, [from, to], handedTo) => {
  const reads = [];
  const pattern = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, "g");
  pattern.lastIndex = from;
  for (let match = pattern.exec(code); match && match.index < to; match = pattern.exec(code)) {
    const after = code.slice(match.index + name.length);
    const before = code.slice(Math.max(0, match.index - 40), match.index);
    // A declaration, a parameter, a property or a JSX attribute of the same name is no use of the translator.
    if (/(const|let|var|function)\s+$/.test(before)) continue;
    if (/^\s*(=(?![=>])|:(?!:)|\?:)/.test(after) && /[{,(]\s*$/.test(before)) continue;
    if (/^\s*=(?![=>])/.test(after) && /<[\w.]+(\s+[\w-]+(=\{[^}]*\}|="[^"]*")?)*\s+$/.test(before)) continue;
    const call = /^\s*(\.(rich|markup|has|raw))?\s*\(/.exec(after);
    if (call) {
      const arg = argumentAt(code, source, match.index + name.length + call[0].length);
      reads.push(...(keysOfArgument(arg.text, arg.code) ?? WHOLE));
      continue;
    }
    reads.push(...(handedTo(enclosingCall(code, match.index)) ?? WHOLE));
  }
  return reads;
};

const full = (ns, read) => ({
  path: ns === "" ? read.path : read.path === "" ? `${ns}.` : `${ns}.${read.path}`,
  prefix: read.prefix,
});

const keyLikeStrings = (source) => [...source.matchAll(/"([a-z]\w*(?:\.\w+)+)"/g)].map((m) => m[1]);

/**
 * The keys a source file reads, as full paths: each `useTranslations(ns)` binding's calls; a translator handed to a
 * function reads what that function reads with it (`memberLabel(…, t)`), found by `handedTo`; whatever the reading
 * cannot pin down reads the binding's whole namespace. An unknown key of the root translator is one of the file's own
 * key-like strings.
 *
 * @param {string} source
 * @param {(call: { name: string; index: number } | null) => { path: string; prefix: boolean }[] | null} [handedTo]
 * @returns {{ path: string; prefix: boolean }[]}
 */
export const translationReads = (source, handedTo = () => null) => {
  const code = blank(source);
  const reads = [];
  const bindings = [];
  for (const match of code.matchAll(/(?:(?:const|let)\s+(\w+)\s*=\s*)?useTranslations\s*(<[^>]*>)?\s*\(/g)) {
    if (/typeof\s+$/.test(code.slice(Math.max(0, match.index - 10), match.index))) continue;
    const arg = argumentAt(code, source, match.index + match[0].length);
    const ns = /^\s*"([^"]*)"\s*$/.exec(arg.text)?.[1] ?? (arg.text.trim() === "" ? "" : null);
    if (ns === null) {
      reads.push(...WHOLE);
      continue;
    }
    if (match[1]) {
      bindings.push({ name: match[1], ns, at: match.index });
      continue;
    }
    const call = /^\s*(\.(rich|markup|has|raw))?\s*\(/.exec(code.slice(arg.end + 1));
    const key = call ? argumentAt(code, source, arg.end + 1 + call[0].length) : null;
    const relative = (key && keysOfArgument(key.text, key.code)) ?? WHOLE;
    reads.push(...relative.map((read) => full(ns, read)));
  }
  for (const [index, binding] of bindings.entries()) {
    const next = bindings.slice(index + 1).find((other) => other.name === binding.name)?.at ?? code.length;
    for (const read of usesOf(binding.name, code, source, [binding.at, next], handedTo)) {
      if (binding.ns === "" && read.prefix && read.path === "")
        reads.push(...keyLikeStrings(source).map((path) => ({ path, prefix: false })));
      else reads.push(full(binding.ns, read));
    }
  }
  return reads;
};

/**
 * The `handedTo` of `translationReads` over the SPA's sources: for a translator handed to the exported function
 * `name` as its argument `index`, what that function reads with it; null when it cannot tell.
 */
export const functionReads = (sources) => {
  const declared = new Map();
  const find = (name) => {
    if (!declared.has(name)) {
      let found = null;
      const exported = new RegExp(`export\\s+(const|function)\\s+${name}\\b`);
      for (const source of sources.values()) {
        if (!exported.test(source)) continue;
        const code = blank(source);
        const declaration = declarationOf(code, name);
        if (declaration) found = { code, source, declaration };
        break;
      }
      declared.set(name, found);
    }
    return declared.get(name);
  };
  return (call) => {
    if (!call) return null;
    const found = find(call.name);
    const param = found?.declaration.params[call.index];
    if (!param) return null;
    return usesOf(param, found.code, found.source, found.declaration.body, () => null);
  };
};

/** A file's imports, re-exports and dynamic imports: the specifier and the names taken, null for all. */
export const importsOf = (source) => {
  const code = blank(source);
  const found = [];
  const named = (list) =>
    list
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "" && !part.startsWith("type "))
      .map((part) => part.split(/\s+as\s+/));
  const statement =
    /(?:^|\n)[ \t]*(import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']|(?:^|\n)[ \t]*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(statement)) {
    const keyword = match.index + match[0].search(/import|export/);
    if (!/^(import|export)/.test(code.slice(keyword))) continue;
    if (match[6]) found.push({ spec: match[6], names: null, reexport: null });
    else if (match[5]) found.push({ spec: match[5], names: [], reexport: null });
    else if (!match[2]) {
      const [, kind, , clause, spec] = match;
      const braces = /\{([^}]*)\}/.exec(clause);
      if (kind === "export") {
        if (/^\*/.test(clause.trim())) found.push({ spec, names: null, reexport: "*" });
        else {
          const list = named(braces?.[1] ?? "");
          if (list.length > 0)
            found.push({
              spec,
              names: list.map(([own]) => own),
              reexport: list.map(([own, as]) => [as ?? own, own]),
            });
        }
        continue;
      }
      const outside = clause
        .replace(/\{[^}]*\}/, "")
        .replace(/,/g, " ")
        .trim();
      if (outside.startsWith("*")) {
        found.push({ spec, names: null, reexport: null });
        continue;
      }
      const taken = [
        ...(outside ? ["default"] : []),
        ...(braces ? named(braces[1]).map(([own]) => own) : []),
      ];
      if (taken.length > 0) found.push({ spec, names: taken, reexport: null });
    }
  }
  return found;
};

/**
 * The SPA's screens read off `routes.tsx` (ruling P276): each route's screen module with the areas its routes load
 * (`staticData.areas`), the areas every one of its routes loads when several share it; any other module the routes
 * import (a pending screen, a layout) with none.
 */
export const routeContexts = (routesSource) => {
  const byModule = new Map();
  const add = (module, areas) => {
    const before = byModule.get(module);
    byModule.set(module, before ? before.filter((area) => areas.includes(area)) : areas);
  };
  for (const [, body] of routesSource.matchAll(/const \w+ = createRoute\(\{([\s\S]*?)\n\}\);/g)) {
    const component = /\n {2}component: lazyRouteComponent\(\(\) => import\("\.\/([\w/-]+)"\)/.exec(
      body,
    )?.[1];
    const list = /areas: \[([^\]]*)\]/.exec(body)?.[1] ?? "";
    if (component)
      add(
        component,
        [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]),
      );
  }
  for (const [, module] of routesSource.matchAll(/import\("\.\/(routes\/[\w/-]+)"\)/g))
    if (!byModule.has(module)) add(module, []);
  return byModule;
};

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * Every file the SPA reaches, with the areas it is always rendered under: the shell's files (from main.tsx, short of
 * the screens routes.tsx loads) with none, each screen's with its routes' areas. A file reached from several gets the
 * areas they all load. Named imports through a re-exporting index follow only the files that export those names.
 */
export const allowedAreas = (
  sources,
  { routesFile = "src/spa/routes.tsx", main = "src/spa/main.tsx" } = {},
) => {
  const resolve = (from, spec) => {
    const base = spec.startsWith("@/")
      ? `src/${spec.slice(2)}`
      : spec.startsWith(".")
        ? posix.join(posix.dirname(from), spec)
        : null;
    return base === null
      ? null
      : (EXTENSIONS.map((ext) => `${base}${ext}`).find((path) => sources.has(path)) ?? null);
  };
  const parsed = new Map();
  const importsIn = (file) => {
    if (!parsed.has(file)) parsed.set(file, importsOf(sources.get(file)));
    return parsed.get(file);
  };
  const contexts = [...routeContexts(sources.get(routesFile) ?? "")].map(([module, areas]) => [
    resolve(routesFile, `./${module}`),
    areas,
  ]);
  const screens = new Set(contexts.map(([file]) => file));
  const allowed = new Map();
  const walk = (start, areas, stopAtScreens) => {
    const seen = new Map();
    const queue = [[start, null]];
    while (queue.length > 0) {
      const [file, names] = queue.shift();
      const before = seen.get(file);
      if (before === null || (before && names && names.every((name) => before.has(name)))) continue;
      seen.set(file, names === null ? null : new Set([...(before ?? []), ...names]));
      for (const entry of importsIn(file)) {
        const target = resolve(file, entry.spec);
        if (!target || (stopAtScreens && screens.has(target))) continue;
        if (entry.reexport === null) queue.push([target, entry.names]);
        else if (entry.reexport === "*") queue.push([target, names]);
        else {
          const wanted = entry.reexport
            .filter(([as]) => names === null || names.includes(as))
            .map(([, own]) => own);
          if (wanted.length > 0) queue.push([target, wanted]);
        }
      }
    }
    for (const file of seen.keys()) {
      const before = allowed.get(file);
      allowed.set(file, before ? before.filter((area) => areas.includes(area)) : areas);
    }
  };
  walk(main, [], true);
  for (const [file, areas] of contexts) if (file) walk(file, areas, false);
  return allowed;
};

/** Whether a read (`{ path, prefix }`) takes the key `key`. */
export const readsKey = (read, key) =>
  read.prefix ? key.startsWith(read.path) : key === read.path || key.startsWith(`${read.path}.`);

/** Each file the SPA reaches: the areas it is rendered under and the keys it reads. */
export const spaReads = (sources) => {
  const handedTo = functionReads(sources);
  return [...allowedAreas(sources)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, areas]) => ({ file, areas, reads: translationReads(sources.get(file), handedTo) }));
};

/**
 * Ruling P276: a key lives in an area file only when every file that reads it is rendered under that area's routes.
 * One the shell, a pending screen or another area's screen reads belongs in the core catalog.
 */
export const checkAreaReads = ({ sources, areaKeys }) =>
  spaReads(sources).flatMap(({ file, areas, reads }) =>
    Object.entries(areaKeys)
      .filter(([area]) => !areas.includes(area))
      .map(([area, keys]) => [area, keys.filter((key) => reads.some((read) => readsKey(read, key)))])
      .filter(([, outside]) => outside.length > 0)
      .map(
        ([area, outside]) =>
          `${file} reads the ${area} area's ${outside.slice(0, 3).join(", ")}${outside.length > 3 ? ` and ${outside.length - 3} more` : ""} outside its routes: move them to the core catalog`,
      ),
  );

/** The SPA's sources (tests and declarations left out), by repository path. */
export const spaSources = (root = ".") =>
  new Map(
    readdirSync(join(root, "src"), { recursive: true })
      .map((file) => `src/${String(file).replaceAll("\\", "/")}`)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$|\.d\.ts$/.test(file))
      .map((file) => [file, readFileSync(join(root, file), "utf8")]),
  );

const MESSAGES = "src/i18n/messages";

/** The core catalog and every area file, as `checkCatalogFiles` takes them. */
export const catalogFiles = (root = ".") => {
  const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const areas = readdirSync(join(root, MESSAGES, "areas"))
    .map((file) => /^([a-z]+)\.es\.json$/.exec(file)?.[1])
    .filter(Boolean)
    .sort();
  return [
    { name: "core", area: null, es: read(`${MESSAGES}/es.json`), en: read(`${MESSAGES}/en.json`) },
    ...areas.map((area) => ({
      name: `areas/${area}`,
      area,
      es: read(`${MESSAGES}/areas/${area}.es.json`),
      en: read(`${MESSAGES}/areas/${area}.en.json`),
    })),
  ];
};

/** Every key of a catalog, its leaves' full paths. */
export const keysOf = (catalog) => leaves(catalog).map(([key]) => key);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = catalogFiles();
  const problems = [
    ...checkCatalogFiles({
      files,
      openapi: JSON.parse(readFileSync("openapi/openapi.snapshot.json", "utf8")),
    }),
    ...checkAreaReads({
      sources: spaSources(),
      areaKeys: Object.fromEntries(
        files.filter((file) => file.area).map((file) => [file.area, keysOf(file.es)]),
      ),
    }),
  ];
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(
    `The core catalog and its ${files.length - 1} area files hold the same keys in es and en, each in one file, and every error and warning code has a message; no screen reads an area's keys outside its routes.`,
  );
}
