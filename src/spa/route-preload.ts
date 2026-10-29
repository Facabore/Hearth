/**
 * ADR 0004 (amended 2026-10-28): the first screen's own chunks download beside the app's script instead of after the
 * router has run, from a table the build reads off `routes.tsx` itself, so it never drifts from the routes. Plain
 * code with no imports: the build runs it, and the app never loads it.
 */
export interface RouteChunks {
  /** The full path, with `$name` parameters, as the router matches it. */
  readonly pattern: string;
  /** Modules under src/spa, without extension: the layouts' chunks, the loaders' and the screen's own. */
  readonly modules: readonly string[];
}

interface Declared {
  readonly parent: string | null;
  readonly path: string | null;
  readonly modules: readonly string[];
}

/** The routes `routes.tsx` declares: their parent, path, component chunk and loader chunks. */
export const routeTable = (source: string): RouteChunks[] => {
  const helpers = new Map(
    [...source.matchAll(/const (\w+) = \(\) => import\("\.\/([\w/-]+)"\);/g)].map(([, name, module]) => [
      name!,
      module!,
    ]),
  );
  const declared = new Map<string, Declared>();
  for (const [, name, body] of source.matchAll(/const (\w+) = createRoute\(\{([\s\S]*?)\n\}\);/g)) {
    const component = /\n {2}component: lazyRouteComponent\(\(\) => import\("\.\/([\w/-]+)"\)/.exec(
      body!,
    )?.[1];
    const loaders = [...body!.matchAll(/\(await (\w+)\(\)\)/g)].map(([, helper]) => helpers.get(helper!));
    declared.set(name!, {
      parent: /getParentRoute: \(\) => (\w+)/.exec(body!)?.[1] ?? null,
      path: /\n {2}path: "([^"]*)"/.exec(body!)?.[1] ?? null,
      modules: [
        ...loaders.filter((module): module is string => module !== undefined),
        ...(component ? [component] : []),
      ],
    });
  }
  const chain = (name: string | null): Declared[] => {
    const route = name === null ? undefined : declared.get(name);
    return route ? [...chain(route.parent), route] : [];
  };
  // Screens only: a layout (the space's shell) shares its path with its index screen and has no chunks of its own.
  const parents = new Set([...declared.values()].map((route) => route.parent));
  return [...declared.entries()]
    .filter(([name, route]) => route.path !== null && !parents.has(name))
    .map(([name]) => {
      const routes = chain(name);
      const pattern = `/${routes
        .map((route) => route.path)
        .filter((path) => path !== null && path !== "/")
        .join("/")}`;
      return { pattern, modules: [...new Set(routes.flatMap((route) => route.modules))] };
    })
    .filter((route) => route.modules.length > 0);
};

/** A pattern's static segments before its parameters, as the router ranks them: `/spaces/new` before `/spaces/$id`. */
const specificity = (pattern: string) =>
  pattern.split("/").map((segment) => (segment.startsWith("$") ? 0 : 1));

/**
 * The inline script that preloads the built files of the screen `location.pathname` names; `files` maps each module
 * of the table to its chunk and the chunks it imports, beyond the ones the app's script already loads.
 */
export const routePreload = (
  table: readonly RouteChunks[],
  files: Readonly<Record<string, readonly string[]>>,
) => {
  const routes = [...table]
    .sort((a, b) => {
      const [x, y] = [specificity(a.pattern), specificity(b.pattern)];
      for (let i = 0; i < Math.max(x.length, y.length); i += 1)
        if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
      return 0;
    })
    .map((route): [string, string[]] => [
      `^${route.pattern.replace(/\$\w+/g, "[^/]+")}/?$`,
      [...new Set(route.modules.flatMap((module) => files[module] ?? []))],
    ])
    .filter(([, list]) => list.length > 0);
  return `(function(){try{var r=${JSON.stringify(routes)};var p=location.pathname;for(var i=0;i<r.length;i++){if(new RegExp(r[i][0]).test(p)){for(var j=0;j<r[i][1].length;j++){var k=document.createElement("link");k.rel="modulepreload";k.crossOrigin="";k.href=r[i][1][j];document.head.appendChild(k)}return}}}catch(e){}})();`;
};

/** A built chunk, as much of it as following its imports needs. */
export interface BuiltChunk {
  readonly fileName: string;
  readonly isEntry: boolean;
  readonly facadeModuleId: string | null;
  readonly imports: readonly string[];
}

/**
 * Each module under src/spa with a chunk of its own, as `routePreload` takes them: its chunk and the chunks those
 * import, without the ones the app's script already loads.
 */
export const chunkFiles = (chunks: readonly BuiltChunk[]): Record<string, string[]> => {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const closure = (chunk: BuiltChunk, seen = new Set<string>()): Set<string> => {
    if (seen.has(chunk.fileName)) return seen;
    seen.add(chunk.fileName);
    for (const name of chunk.imports) {
      const imported = byName.get(name);
      if (imported) closure(imported, seen);
    }
    return seen;
  };
  const loaded = new Set(chunks.filter((chunk) => chunk.isEntry).flatMap((chunk) => [...closure(chunk)]));
  return Object.fromEntries(
    chunks.flatMap((chunk) => {
      const module = /\/src\/spa\/(.+)\.tsx?$/.exec(chunk.facadeModuleId?.replaceAll("\\", "/") ?? "")?.[1];
      if (!module || chunk.isEntry) return [];
      return [[module, [...closure(chunk)].filter((name) => !loaded.has(name)).map((name) => `/${name}`)]];
    }),
  );
};

/**
 * The inline script that marks which static frame `index.html` paints before the app runs: the public one (the logo,
 * as the sign-in screen shows it) on the screens the public layout wraps, the app's (its header and bottom bar)
 * elsewhere. React replaces both when it renders, so nothing on screen moves (CLS counts elements that move, not ones
 * that go away).
 */
export const framePick = (table: readonly RouteChunks[]): string => {
  const visitor = table
    .filter((route) => route.modules.includes("routes/public-layout"))
    .map((route) => `^${route.pattern.replace(/\$\w+/g, "[^/]+")}/?$`);
  return `(function(){try{var v=${JSON.stringify(visitor)};var p=location.pathname;var f="app";for(var i=0;i<v.length;i++)if(new RegExp(v[i]).test(p))f="public";document.documentElement.dataset.frame=f}catch(e){}})();`;
};
