import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { jsonResponse, fakeApi } from "../../tests/support/ui/fake-api";
import { takeSettledWrite, trackWrites, type WritePlanner } from "./writes";

const PATCH = "PATCH /api/v1/spaces/{spaceId}/transactions/{transactionId}";
const call = { params: { path: { spaceId: "sp-1", transactionId: "t-1" } }, body: {} };

/** Plans every PATCH and nothing else. */
const patches: WritePlanner = (write) => (write.method === "PATCH" ? { accepted: () => undefined } : null);

describe("the app's writes (ADR 0006)", () => {
  it("still saves when the write plans cannot load, such as a chunk gone after a release", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse({ id: "t-1" }) });
    const queryClient = new QueryClient();
    const tracked = trackWrites(api, queryClient, () => Promise.reject(new TypeError("Failed to fetch")));

    const result = await tracked.PATCH(
      "/api/v1/spaces/{spaceId}/transactions/{transactionId}",
      call as never,
    );

    expect(result.response.ok).toBe(true);
    expect(requests.map((r) => r.method)).toEqual(["PATCH"]);
    // Nothing updated the cache, so the components' refresh() must read the screen again.
    expect(takeSettledWrite(queryClient)).toBe(false);
  });

  it("forgets a settled write once another write starts, so a later refresh() is never skipped", async () => {
    const { api } = fakeApi({
      [PATCH]: () => jsonResponse({ id: "t-1" }),
      "DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}": () =>
        new Response(null, { status: 204 }),
    });
    const queryClient = new QueryClient();
    const tracked = trackWrites(api, queryClient, () => Promise.resolve(patches));

    await tracked.PATCH("/api/v1/spaces/{spaceId}/transactions/{transactionId}", call as never);
    await tracked.DELETE("/api/v1/spaces/{spaceId}/transactions/{transactionId}", call as never);

    expect(takeSettledWrite(queryClient)).toBe(false);
  });

  it("marks a planned write that the API accepted, once", async () => {
    const { api } = fakeApi({ [PATCH]: () => jsonResponse({ id: "t-1" }) });
    const queryClient = new QueryClient();
    const tracked = trackWrites(api, queryClient, () => Promise.resolve(patches));

    await tracked.PATCH("/api/v1/spaces/{spaceId}/transactions/{transactionId}", call as never);

    expect(takeSettledWrite(queryClient)).toBe(true);
    expect(takeSettledWrite(queryClient)).toBe(false);
  });
});
