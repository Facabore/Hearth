import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogPreload, EARLY_READS, earlyResult, takeEarlyReads } from "./early";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Runs the inline script the HTML carries, over a fake `fetch`, and hands back what it left for the app. */
const boot = (answers: Record<string, Response>) => {
  const fetch = vi.fn(async (url: string) => answers[url]!.clone());
  vi.stubGlobal("fetch", fetch);
  new Function(EARLY_READS)();
  return { fetch, reads: takeEarlyReads() };
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __hearthEarly?: unknown }).__hearthEarly;
});

describe("the reads the HTML starts before the app's script arrives (ADR 0004, 2026-10-28)", () => {
  it("reads the profile at once, then the spaces only for a signed-in person", async () => {
    const signedIn = boot({ "/api/v1/me": json({ id: "u-ana" }), "/api/v1/spaces": json({ items: [] }) });
    expect(await (await signedIn.reads!.me).json()).toEqual({ id: "u-ana" });
    expect(await (await signedIn.reads!.spaces)!.json()).toEqual({ items: [] });
    expect(signedIn.fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/me", "/api/v1/spaces"]);
    delete (globalThis as { __hearthEarly?: unknown }).__hearthEarly;

    // A visitor asks for no spaces: the API would only answer 401.
    const visitor = boot({ "/api/v1/me": json({ code: "Unauthenticated" }, 401) });
    expect((await visitor.reads!.me).status).toBe(401);
    expect(await visitor.reads!.spaces).toBeNull();
    expect(visitor.fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/me"]);
  });

  it("hands its reads over once: a later screen reads the API itself", () => {
    boot({ "/api/v1/me": json({ id: "u-ana" }), "/api/v1/spaces": json({ items: [] }) });
    expect(takeEarlyReads()).toBeNull();
  });

  it("answers as the generated client does: the body as data, or as the error of a refusal", async () => {
    expect(await earlyResult(Promise.resolve(json({ id: "u-ana" })))).toMatchObject({
      data: { id: "u-ana" },
    });
    const refused = await earlyResult(Promise.resolve(json({ code: "Unauthenticated" }, 401)));
    expect(refused.data).toBeUndefined();
    expect(refused.error).toEqual({ code: "Unauthenticated" });
    expect(refused.response.status).toBe(401);
  });

  it("preloads the catalog of the language the app will pick: the cookie, then the browser's, then Spanish", () => {
    const files = { es: "/assets/es-1.js", en: "/assets/en-1.js" };
    const preloaded = (cookie: string, languages: string[]) => {
      document.head.querySelectorAll("link[rel=modulepreload]").forEach((link) => link.remove());
      document.cookie = `hearth.locale=; max-age=0; path=/`;
      if (cookie) document.cookie = `hearth.locale=${cookie}; path=/`;
      vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
      new Function(catalogPreload(files))();
      return [...document.head.querySelectorAll("link[rel=modulepreload]")].map((link) =>
        link.getAttribute("href"),
      );
    };
    expect(preloaded("en", ["es-CO"])).toEqual(["/assets/en-1.js"]);
    expect(preloaded("", ["fr-FR", "en-US", "es"])).toEqual(["/assets/en-1.js"]);
    expect(preloaded("", ["es-CO"])).toEqual(["/assets/es-1.js"]);
    expect(preloaded("", ["fr"])).toEqual(["/assets/es-1.js"]);
    expect(preloaded("de", [])).toEqual(["/assets/es-1.js"]);
  });
});
