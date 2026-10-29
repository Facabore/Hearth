import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { routePreload, routeTable } from "./route-preload";

const table = routeTable(readFileSync("src/spa/routes.tsx", "utf8"));
const modulesOf = (pattern: string) => table.find((route) => route.pattern === pattern)?.modules;

/** Runs the inline script at `pathname` and answers what it preloaded. */
const preloadedAt = (pathname: string, files: Record<string, readonly string[]>) => {
  document.head.querySelectorAll("link[rel=modulepreload]").forEach((link) => link.remove());
  window.history.replaceState(null, "", pathname);
  new Function(routePreload(table, files))();
  return [...document.head.querySelectorAll("link[rel=modulepreload]")].map((link) => link.getAttribute("href"));
};

afterEach(() => window.history.replaceState(null, "", "/"));

describe("the first screen's chunks, preloaded by the HTML (ADR 0004, 2026-10-28)", () => {
  it("reads every screen's own chunk, its layout's and its loaders' from the route table", () => {
    expect(modulesOf("/spaces/$spaceId")).toEqual(["routes/space-shell", "ledger/queries", "routes/space-home"]);
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
      "routes/public-layout": ["/assets/public.js"],
      "routes/sign-in": ["/assets/sign-in.js"],
    };
    expect(preloadedAt("/spaces/sp-1/transactions", files)).toEqual([
      "/assets/shell.js",
      "/assets/ledger.js",
      "/assets/list.js",
    ]);
    expect(preloadedAt("/spaces/sp-1", files)).toEqual(["/assets/shell.js", "/assets/ledger.js", "/assets/home.js"]);
    expect(preloadedAt("/spaces/new", files)).toEqual(["/assets/settings.js", "/assets/shared.js"]);
    expect(preloadedAt("/sign-in", files)).toEqual(["/assets/public.js", "/assets/sign-in.js"]);
    // An address no screen has, and a file that is preloaded twice, add nothing.
    expect(preloadedAt("/nope/deeper", files)).toEqual([]);
  });
});
