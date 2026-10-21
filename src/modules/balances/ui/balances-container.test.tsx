import { describe, expect, it, vi } from "vitest";
import { cop, memberDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../tests/support/ui/fake-api";

vi.mock("@/shared/ui/api/server", async () => ({
  loaded: async (call: Promise<{ data?: unknown; response: Response }>) => {
    const { data } = await call;
    return { ok: true, data };
  },
}));
const { loadBalances } = await import("./balances-container");

describe("loadBalances (HU-E9-07)", () => {
  it("reads the members, the balances and the suggestions of the space together", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
      "GET /api/v1/spaces/{spaceId}/balances": () =>
        jsonResponse({ members: [{ memberId: "m-ana", net: cop(0) }] }),
      "GET /api/v1/spaces/{spaceId}/balances/suggestions": () => jsonResponse({ suggestions: [] }),
    });
    expect(await loadBalances(api, { spaceId: "sp-household" })).toEqual({
      ok: true,
      data: { members: [memberDto()], balances: [{ memberId: "m-ana", net: cop(0) }], suggestions: [] },
    });
    expect(requests).toHaveLength(3);
  });
});
