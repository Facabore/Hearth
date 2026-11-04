import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chunkFiles, framePick, routeAreas, routePreload, routeTable } from "./route-preload";

const table = routeTable(readFileSync("src/spa/routes.tsx", "utf8"));
const modulesOf = (pattern: string) => table.find((route) => route.pattern === pattern)?.modules;
const areasOf = (pattern: string) => table.find((route) => route.pattern === pattern)?.areas;

/** Runs the inline script at `pathname` and answers what it preloaded. */
const preloadedAt = (pathname: string, files: Record<string, readonly string[]>) => {
  document.head.querySelectorAll("link[rel=modulepreload]").forEach((link) => link.remove());
  window.history.replaceState(null, "", pathname);
  new Function(routePreload(table, files))();
  return [...document.head.querySelectorAll("link[rel=modulepreload]")].map((link) =>
    link.getAttribute("href"),
  );
};

afterEach(() => window.history.replaceState(null, "", "/"));

describe("the first screen's chunks, preloaded by the HTML (ADR 0004, 2026-10-28)", () => {
  it("reads every screen's own chunk, its layout's and its loaders' from the route table", () => {
    expect(modulesOf("/spaces/$spaceId")).toEqual([
      "routes/space-shell",
      "ledger/queries",
      "routes/space-home",
    ]);
    expect(modulesOf("/spaces/$spaceId/transactions")).toEqual([
      "routes/space-shell",
      "ledger/queries",
      "routes/transactions",
    ]);
    expect(modulesOf("/spaces/$spaceId/accounts/new")).toEqual(["routes/space-shell", "routes/accounts"]);
    expect(modulesOf("/spaces/$spaceId/plans/$planId/lines/$lineId")).toEqual([
      "routes/space-shell",
      "plan/loaders",
      "routes/plans",
    ]);
    expect(modulesOf("/sign-in")).toEqual(["routes/public-layout", "routes/sign-in"]);
    expect(modulesOf("/invitations/$token")).toEqual(["routes/public-layout", "routes/invitation"]);
    expect(modulesOf("/settings")).toEqual(["routes/settings"]);
    // Ruling P276: New space has a chunk of its own, without the Settings form and its copy.
    expect(modulesOf("/spaces/new")).toEqual(["routes/new-space"]);
    // Every screen with an address of its own: all the routes with a path but "/", a redirect, and the space's shell.
    const paths = readFileSync("src/spa/routes.tsx", "utf8").match(/\n {2}path: "/g)!.length;
    expect(table).toHaveLength(paths - 2);
  });

  it("preloads the files of the screen the address names, a static segment before a parameter", () => {
    const files = {
      "routes/space-shell": ["/assets/shell.js"],
      "ledger/queries": ["/assets/ledger.js"],
      "routes/space-home": ["/assets/home.js"],
      "routes/transactions": ["/assets/list.js"],
      "routes/settings": ["/assets/settings.js", "/assets/shared.js"],
      "routes/new-space": ["/assets/new-space.js", "/assets/shared.js"],
      "routes/public-layout": ["/assets/public.js"],
      "routes/sign-in": ["/assets/sign-in.js"],
    };
    expect(preloadedAt("/spaces/sp-1/transactions", files)).toEqual([
      "/assets/shell.js",
      "/assets/ledger.js",
      "/assets/list.js",
    ]);
    expect(preloadedAt("/spaces/sp-1", files)).toEqual([
      "/assets/shell.js",
      "/assets/ledger.js",
      "/assets/home.js",
    ]);
    expect(preloadedAt("/spaces/new", files)).toEqual(["/assets/new-space.js", "/assets/shared.js"]);
    expect(preloadedAt("/sign-in", files)).toEqual(["/assets/public.js", "/assets/sign-in.js"]);
    // An address no screen has adds nothing, and a file two modules share is preloaded once.
    expect(preloadedAt("/nope/deeper", files)).toEqual([]);
    expect(
      preloadedAt("/settings", { ...files, "routes/settings": ["/assets/shared.js", "/assets/shared.js"] }),
    ).toEqual(["/assets/shared.js"]);
  });

  it("maps each module to its chunk and what that imports, beyond the chunks the app's script loads", () => {
    // Windows separators, as the build reports them there.
    const id = (module: string) => `C:\\repo\\src\\spa\\${module.replaceAll("/", "\\")}.tsx`;
    const chunk = (
      fileName: string,
      module: string | null,
      imports: string[],
      isEntry = false,
      others: string[] = [],
    ) => ({
      fileName,
      facadeModuleId: module === null ? null : id(module),
      moduleIds: [...(module === null ? [] : [id(module)]), ...others.map(id)],
      imports,
      isEntry,
    });
    expect(
      chunkFiles([
        chunk("assets/index.js", "main", ["assets/framework.js"], true, ["routes"]),
        chunk("assets/framework.js", null, []),
        chunk("assets/transactions.js", "routes/transactions", ["assets/framework.js", "assets/list-row.js"]),
        chunk("assets/list-row.js", null, ["assets/icon.js"]),
        chunk("assets/icon.js", null, []),
        // A loader a screen also imports lives in a chunk the two share, with no facade of its own: still the loader's.
        chunk("assets/loaders.js", null, ["assets/icon.js"], false, ["plan/loaders", "plan/period"]),
      ]),
    ).toEqual({
      "routes/transactions": ["/assets/transactions.js", "/assets/list-row.js", "/assets/icon.js"],
      "plan/loaders": ["/assets/loaders.js", "/assets/icon.js"],
      "plan/period": ["/assets/loaders.js", "/assets/icon.js"],
    });
  });

  it("reads each screen's catalog areas from its route, and ranks them as the router ranks the paths (ruling P276)", () => {
    expect(areasOf("/invitations/$token")).toEqual(["invitation"]);
    expect(areasOf("/claims/$token")).toEqual(["invitation"]);
    expect(areasOf("/spaces/$spaceId/plans/$planId/capacities")).toEqual(["plan"]);
    expect(areasOf("/spaces/$spaceId/members")).toEqual(["members"]);
    expect(areasOf("/spaces/$spaceId")).toEqual([]);
    expect(areasOf("/sign-in")).toEqual([]);
    const ranked = routeAreas(table);
    const first = (pathname: string) => ranked.find(([pattern]) => new RegExp(pattern).test(pathname))?.[1];
    expect(first("/invitations/tok")).toEqual(["invitation"]);
    expect(first("/spaces/sp-1/plans/pl-1/capacities")).toEqual(["plan"]);
    // A static segment before a parameter: New space is not the home of a space called "new".
    expect(first("/spaces/new")).toEqual(areasOf("/spaces/new"));
    expect(first("/spaces/sp-1")).toEqual([]);
    expect(first("/nope/deeper")).toBeUndefined();
  });

  it("turns Inter on and preloads it only when the first screen is in the app, never on a visitor's page (P299)", () => {
    const fontAt = (pathname: string) => {
      window.history.replaceState(null, "", pathname);
      delete document.documentElement.dataset.font;
      document.head.querySelectorAll("link[rel=preload][as=font]").forEach((link) => link.remove());
      new Function(framePick(table))();
      const link = document.head.querySelector("link[rel=preload][as=font]");
      return [document.documentElement.dataset.font ?? null, link?.getAttribute("href") ?? null];
    };
    for (const visitor of ["/sign-in", "/sign-up", "/invitations/tok", "/claims/clm"])
      expect(fontAt(visitor), visitor).toEqual([null, null]);
    expect(fontAt("/spaces/sp-1/transactions")).toEqual(["inter", "/fonts/inter-latin-wght-normal.woff2"]);
    const link = document.head.querySelector("link[rel=preload][as=font]")!;
    expect([link.getAttribute("type"), link.hasAttribute("crossorigin")]).toEqual(["font/woff2", true]);
  });

  it("marks the public frame on the screens the public layout wraps, and the app's elsewhere", () => {
    const frameAt = (pathname: string) => {
      window.history.replaceState(null, "", pathname);
      delete document.documentElement.dataset.frame;
      new Function(framePick(table))();
      return document.documentElement.dataset.frame;
    };
    expect(["/sign-in", "/sign-up/", "/invitations/tok", "/claims/clm"].map(frameAt)).toEqual([
      "public",
      "public",
      "public",
      "public",
    ]);
    expect(["/", "/spaces/sp-1/transactions", "/settings", "/sign-in-later"].map(frameAt)).toEqual([
      "app",
      "app",
      "app",
      "app",
    ]);
  });
});
