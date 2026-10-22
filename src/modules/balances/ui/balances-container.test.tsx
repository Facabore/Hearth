import { describe, expect, it, vi } from "vitest";
import { accountDto, cop, memberDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";

vi.mock("@/shared/ui/api/server", async () => ({
  loaded: async (call: Promise<{ data?: unknown; response: Response }>) => {
    const { data, response } = await call;
    return response.ok ? { ok: true, data } : { ok: false, problem: { code: "InternalError" } };
  },
}));
const { loadBalances, loadMyAccounts } = await import("./balances-container");

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

describe("loadMyAccounts (HU-E9-07, ruling P174)", () => {
  const input = {
    spaceId: "sp-trip",
    personalSpaceId: "sp-personal",
    meUserId: "u-juan",
    members: [
      memberDto(),
      memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }),
    ],
  };
  const accounts = (items: unknown[]) => () => jsonResponse({ items });

  it("offers the accounts the viewer owns: those of the personal space, then their own in this space", async () => {
    const personal = accountDto({ id: "a-personal", ownerUserId: "u-juan" });
    const mine = accountDto({ id: "a-mine", ownerUserId: "u-juan" });
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/accounts": (_request, params) =>
        jsonResponse({
          items:
            params.spaceId === "sp-personal"
              ? [personal]
              : [
                  mine,
                  accountDto({ id: "a-ana", ownerUserId: "u-ana" }),
                  accountDto({ id: "a-fund", type: "SHARED_FUND", ownerUserId: null }),
                ],
        }),
    });
    expect((await loadMyAccounts(api, input)).map((account) => account.id)).toEqual(["a-personal", "a-mine"]);
    expect(requests).toHaveLength(2);
  });

  it("leaves the optional accounts out when they cannot be read, instead of failing the balances", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/accounts": () => problemResponse(500, "InternalError"),
    });
    expect(await loadMyAccounts(api, input)).toEqual([]);
  });

  it("has none for somebody who is not a current member", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/accounts": accounts([accountDto()]) });
    expect(await loadMyAccounts(api, { ...input, meUserId: "u-stranger" })).toEqual([]);
  });
});
