import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { fakeApi, problemResponse } from "../../tests/support/ui/fake-api";
import { guardSession, type RouterContext } from "./guards";

const visitorContext = () => {
  const { api, requests } = fakeApi({ "GET /api/v1/me": () => problemResponse(401, "Unauthenticated") });
  const context: RouterContext = { queryClient: new QueryClient(), apis: { api, sessionApi: api } };
  return { context, requests };
};

const outcome = (promise: Promise<void>) =>
  promise.then(
    () => "passes",
    (error: unknown) => (isRedirect(error) ? `redirects to ${String(error.options.href)}` : "throws"),
  );

describe("the session guard (HU-E9-01)", () => {
  it("lets a visitor open the trust page, with or without its query, without reading the session (issue #146)", async () => {
    const { context, requests } = visitorContext();
    for (const searchStr of ["", "?next=%2F&invitation=tok", "?from=sp-personal"])
      expect(await outcome(guardSession(context, { pathname: "/trust", searchStr }))).toBe("passes");
    expect(requests).toEqual([]);
  });

  it("still sends a visitor on any path under the trust page, or one that only starts like it, to sign in", async () => {
    const { context } = visitorContext();
    for (const pathname of ["/trust/x", "/trusted", "/settings"])
      expect(await outcome(guardSession(context, { pathname, searchStr: "" }))).toBe(
        `redirects to /sign-in?next=${encodeURIComponent(pathname)}`,
      );
  });
});
