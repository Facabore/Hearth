import { describe, expect, it, vi } from "vitest";
import { browserApi } from "./client";

const where = (pathname: string, search = "") => ({
  origin: "http://hearth.test",
  pathname,
  search,
  assign: vi.fn(),
});

const answering = (status: number) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code: "Unauthenticated" }), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("browserApi (ruling P151): an expired session in the browser", () => {
  it("sends a 401 from a page's call to the sign-in screen with the page to return to", async () => {
    answering(401);
    const location = where("/spaces/s1/transactions", "?period=2026-10");
    await browserApi(location).GET("/api/v1/spaces");
    expect(location.assign).toHaveBeenCalledTimes(1);
    expect(location.assign).toHaveBeenCalledWith(
      "/sign-in?next=%2Fspaces%2Fs1%2Ftransactions%3Fperiod%3D2026-10&expired=1",
    );
    vi.unstubAllGlobals();
  });

  it("leaves the sign-in screen's own 401 (wrong credentials) to the form", async () => {
    answering(401);
    const location = where("/sign-in");
    await browserApi(location).POST("/api/v1/auth/sign-in", { body: { email: "a@b.co", password: "x" } });
    expect(location.assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never sends the sign-in or sign-up screen to itself when a call left over from the last page answers 401", async () => {
    answering(401);
    for (const [pathname, search] of [
      ["/sign-in", ""],
      ["/sign-in", "?next=%2Fsettings&expired=1"],
      ["/sign-up", ""],
    ] as const) {
      const location = where(pathname, search);
      await browserApi(location).GET("/api/v1/spaces");
      expect(location.assign, `${pathname}${search}`).not.toHaveBeenCalled();
    }
    vi.unstubAllGlobals();
  });

  it("leaves other failures and successes alone", async () => {
    const location = where("/settings");
    answering(500);
    await browserApi(location).GET("/api/v1/spaces");
    answering(200);
    await browserApi(location).GET("/api/v1/spaces");
    expect(location.assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
