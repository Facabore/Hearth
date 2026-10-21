import { describe, expect, it, vi } from "vitest";
import { cop, memberDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";

vi.mock("@/shared/ui/api/server", async () => ({
  loaded: async (call: Promise<{ data?: unknown; response: Response }>) => {
    const { data, response } = await call;
    return response.ok ? { ok: true, data } : { ok: false, problem: { status: response.status } };
  },
}));
const { loadBalanceHistory } = await import("./history-container");

const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const SEPTEMBER = { label: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" };
const NOVEMBER = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
const HISTORY = {
  memberId: "m-juan",
  from: "2026-10-01",
  to: "2026-10-31",
  opening: cop(0),
  closing: cop(0),
  entries: [],
};
const MEMBERS = { "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [JUAN] }) };
const HISTORY_ROUTE = {
  "GET /api/v1/spaces/{spaceId}/members/{memberId}/balance-history": () => jsonResponse(HISTORY),
};

describe("loadBalanceHistory (ruling P176)", () => {
  it("reads the period holding `from`, its neighbours and the member's movements within it", async () => {
    const periods = { "2026-10-15": OCTOBER, "2026-09-30": SEPTEMBER, "2026-11-01": NOVEMBER } as Record<
      string,
      unknown
    >;
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": (r) =>
        jsonResponse({ items: [periods[new URL(r.url).searchParams.get("from")!]] }),
      ...MEMBERS,
      ...HISTORY_ROUTE,
    });
    const result = await loadBalanceHistory(api, {
      spaceId: "sp-household",
      memberId: "m-juan",
      from: "2026-10-15",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { member: JUAN, period: OCTOBER, previous: SEPTEMBER, next: NOVEMBER, history: HISTORY },
    });
    const history = requests.find((r) => r.url.includes("balance-history"))!;
    expect(Object.fromEntries(new URL(history.url).searchParams)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("asks for the current period without `from`, and finds no member who is not a current one", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": (r) =>
        jsonResponse({ items: new URL(r.url).searchParams.has("from") ? [] : [OCTOBER] }),
      ...MEMBERS,
      ...HISTORY_ROUTE,
    });
    const result = await loadBalanceHistory(api, { spaceId: "sp-household", memberId: "m-gone" });
    expect(result).toMatchObject({
      ok: true,
      data: { member: null, period: OCTOBER, previous: null, next: null },
    });
    const current = new URL(requests.find((r) => r.url.includes("/periods"))!.url).searchParams;
    expect(current.get("count")).toBe("1");
    expect(current.has("from")).toBe(false);
  });

  it("answers the problem of the first reads, but a failing neighbour is just absent", async () => {
    const failing = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => problemResponse(403, "Forbidden"),
      ...MEMBERS,
    });
    expect(await loadBalanceHistory(failing.api, { spaceId: "sp-household", memberId: "m-juan" })).toEqual({
      ok: false,
      problem: { status: 403 },
    });

    const neighbours = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": (r) =>
        new URL(r.url).searchParams.has("from")
          ? problemResponse(500, "InternalError")
          : jsonResponse({ items: [OCTOBER] }),
      ...MEMBERS,
      ...HISTORY_ROUTE,
    });
    expect(
      await loadBalanceHistory(neighbours.api, { spaceId: "sp-household", memberId: "m-juan" }),
    ).toMatchObject({
      ok: true,
      data: { period: OCTOBER, previous: null, next: null },
    });
  });
});
