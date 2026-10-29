import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SpaApis } from "./api";
import { earlyResult, seedEarlyReads, takeEarlyReads, type EarlyReads } from "./early";
import { catalogPreload, EARLY_READS } from "./early-html";
import { queryKeys } from "./queries";

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
    // A cookie naming no language, even one an object inherits, preloads the browser's or Spanish.
    expect(preloaded("constructor", [])).toEqual(["/assets/es-1.js"]);
  });

  describe("handing the early reads to the queries", () => {
    const apisWith = (get: ReturnType<typeof vi.fn>) =>
      ({ api: { GET: get }, sessionApi: { GET: get } }) as unknown as SpaApis;
    const generated = (body: unknown) => ({ data: body, response: json(body) });
    const seeded = async (early: EarlyReads, get = vi.fn()) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      seedEarlyReads(queryClient, apisWith(get), early);
      await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
      return { queryClient, get };
    };

    it("caches the profile and the spaces the HTML read, without asking the API again", async () => {
      const { queryClient, get } = await seeded({
        me: Promise.resolve(json({ id: "u-ana" })),
        spaces: Promise.resolve(json({ items: [{ id: "sp-personal" }] })),
      });
      expect(queryClient.getQueryData(queryKeys.me)).toEqual({ id: "u-ana" });
      expect(queryClient.getQueryData(queryKeys.spaces)).toEqual([{ id: "sp-personal" }]);
      expect(get).not.toHaveBeenCalled();
    });

    it("caches a visitor as nobody and reads no spaces for them", async () => {
      const { queryClient, get } = await seeded({
        me: Promise.resolve(json({ code: "Unauthenticated" }, 401)),
        spaces: Promise.resolve(null),
      });
      expect(queryClient.getQueryData(queryKeys.me)).toBeNull();
      expect(queryClient.getQueryState(queryKeys.spaces)).toBeUndefined();
      expect(get).not.toHaveBeenCalled();
    });

    it("asks the API for the spaces when the HTML's read of them failed on the network", async () => {
      const get = vi.fn(async () => generated({ items: [{ id: "sp-personal" }] }));
      const { queryClient } = await seeded(
        { me: Promise.resolve(json({ id: "u-ana" })), spaces: Promise.resolve(null) },
        get,
      );
      expect(queryClient.getQueryData(queryKeys.spaces)).toEqual([{ id: "sp-personal" }]);
      expect(get).toHaveBeenCalledWith("/api/v1/spaces");
    });

    it("uses each early answer once: reading the profile again asks the API", async () => {
      const get = vi.fn(async () => generated({ id: "u-ana", name: "Ana" }));
      const { queryClient } = await seeded(
        { me: Promise.resolve(json({ id: "u-ana" })), spaces: Promise.resolve(json({ items: [] })) },
        get,
      );
      await queryClient.refetchQueries({ queryKey: queryKeys.me, type: "all" });
      expect(get).toHaveBeenCalledWith("/api/v1/me");
      expect(queryClient.getQueryData(queryKeys.me)).toEqual({ id: "u-ana", name: "Ana" });
    });
  });
});
