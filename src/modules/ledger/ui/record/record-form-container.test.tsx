import { describe, expect, it, vi } from "vitest";
import {
  accountDto,
  guestDto,
  householdSpace,
  memberDto,
  spaceDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";

vi.mock("@/shared/ui/api/server", async () => ({
  loaded: async (call: Promise<{ data?: unknown; error?: unknown; response: Response }>) => {
    const { data, error } = await call;
    return error ? { ok: false, problem: { code: "Failed" } } : { ok: true, data };
  },
}));
const { loadPeople, loadSharedContext } = await import("./record-form-container");

const input = {
  spaceId: "sp-household",
  meUserId: "u-ana",
  personalSpaceId: "sp-personal",
  spaceAccounts: [accountDto({ id: "a-cash", ownerUserId: "u-ana" })],
};

describe("loadSharedContext (HU-E9-06, ruling P168)", () => {
  it("reads the space's members and the accounts of the recorder's personal space", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto(), guestDto()] }),
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({ items: [accountDto({ id: "a-bank", name: "Bancolombia" })] }),
    });
    const result = await loadSharedContext(api, input);
    expect(result).toMatchObject({
      ok: true,
      data: { meMemberId: "m-ana", funds: [] },
    });
    expect(result.ok && result.data?.members.map((m) => m.id)).toEqual(["m-ana", "m-pedro"]);
    expect(result.ok && result.data?.myAccounts.map((a) => a.id)).toEqual(["a-bank", "a-cash"]);
    expect(requests.map((r) => new URL(r.url).pathname).sort()).toEqual([
      "/api/v1/spaces/sp-household/members",
      "/api/v1/spaces/sp-personal/accounts",
    ]);
  });

  it("answers no context for someone who is not a current member", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto({ userId: "u-x" })] }),
      "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse({ items: [] }),
    });
    expect(await loadSharedContext(api, input)).toEqual({ ok: true, data: null });
  });

  it("passes on the problem of a failed read", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => problemResponse(403, "Forbidden"),
      "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse({ items: [] }),
    });
    expect(await loadSharedContext(api, input)).toMatchObject({ ok: false });
  });
});

describe("loadPeople (HU-E9-06, ruling P172)", () => {
  const spaces = [
    spaceDto(),
    householdSpace(),
    householdSpace({ id: "sp-ana-juan", name: "Ana & Juan", kind: "DIRECT" }),
    householdSpace({ id: "sp-broken", name: "Broken" }),
  ];
  const juan = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });

  it("reads the members of every space but the personal one and lists the other people", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": (_request, { spaceId }) =>
        jsonResponse({ items: spaceId === "sp-household" ? [memberDto(), guestDto()] : [memberDto(), juan] }),
    });
    const people = await loadPeople(api, { meUserId: "u-ana", spaces });
    expect(requests.map((r) => new URL(r.url).pathname).sort()).toEqual([
      "/api/v1/spaces/sp-ana-juan/members",
      "/api/v1/spaces/sp-broken/members",
      "/api/v1/spaces/sp-household/members",
    ]);
    expect(people).toEqual([{ memberId: "m-juan", name: "Juan", isGuest: false, directSpace: "Ana & Juan" }]);
  });

  it("leaves out the people of a space that could not be read", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": (_request, { spaceId }) =>
        spaceId === "sp-ana-juan"
          ? problemResponse(500, "InternalError")
          : jsonResponse({ items: [memberDto(), juan] }),
    });
    const people = await loadPeople(api, { meUserId: "u-ana", spaces });
    expect(people).toEqual([{ memberId: "m-juan", name: "Juan", isGuest: false, directSpace: null }]);
  });
});
