import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(mocks.headers) }));
// React's own `cache` memoizes per request only inside a server render; here one map stands for one request.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const seen = new Map<string, R>();
      return (...args: A) => {
        const key = JSON.stringify(args);
        if (!seen.has(key)) seen.set(key, fn(...args));
        return seen.get(key)!;
      };
    },
  };
});
const { documentFirst, routeScreen } = await import("./route-screen");

type Params = { spaceId: string };

/** A route whose screen records each render, the way a container's reads would run. */
const route = () => {
  const render = vi.fn(async (params: Params, search: Record<string, string | string[] | undefined>) =>
    JSON.stringify({ params, search }),
  );
  const page = routeScreen<Params>(render);
  return { render, page, layout: documentFirst(page) };
};

const request = (path: string, document: boolean) => {
  mocks.headers = { "x-hearth-path": path, "x-hearth-document": document ? "1" : "0" };
};

describe("a route's screen around its loading boundary (#196)", () => {
  it("renders the screen from the layout first on a document request, and the page reuses that render", async () => {
    const { render, page, layout } = route();
    request("/spaces/s1/transactions?period=2026-10&categoryId=c1&categoryId=c2", true);
    const order: string[] = [];
    render.mockImplementation(async (params, search) => {
      order.push("screen");
      return JSON.stringify({ params, search });
    });
    const children = "children";
    expect(await layout({ children, params: Promise.resolve({ spaceId: "s1" }) })).toBe(children);
    order.push("children");
    const shown = await page({
      params: Promise.resolve({ spaceId: "s1" }),
      searchParams: Promise.resolve({ period: "2026-10", categoryId: ["c1", "c2"] }),
    });
    expect(order).toEqual(["screen", "children"]);
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith({ spaceId: "s1" }, { period: "2026-10", categoryId: ["c1", "c2"] });
    expect(shown).toBe(
      JSON.stringify({ params: { spaceId: "s1" }, search: { period: "2026-10", categoryId: ["c1", "c2"] } }),
    );
  });

  it("lets a not-found or a redirect of the screen leave the layout on a document request, before any stream", async () => {
    const { render, layout } = route();
    request("/spaces/s1/members", true);
    render.mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(
      layout({ children: "children", params: Promise.resolve({ spaceId: "s1" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("leaves the screen to the page on a client navigation, so the prefetched skeleton shows at once", async () => {
    const { render, page, layout } = route();
    request("/spaces/s1/accounts", false);
    expect(await layout({ children: "children", params: Promise.resolve({ spaceId: "s1" }) })).toBe(
      "children",
    );
    expect(render).not.toHaveBeenCalled();
    await page({ params: Promise.resolve({ spaceId: "s1" }), searchParams: Promise.resolve({}) });
    expect(render).toHaveBeenCalledOnce();
  });
});
