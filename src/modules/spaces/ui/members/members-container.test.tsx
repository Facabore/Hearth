import { describe, expect, it, vi } from "vitest";
import { invitationDto, memberDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";

vi.mock("@/shared/ui/api/server", async () => ({
  loaded: async (call: Promise<{ data?: unknown; response: Response }>) => {
    const { data } = await call;
    return { ok: true, data };
  },
}));
const { loadMembers } = await import("./members-container");

describe("loadMembers (HU-E9-05)", () => {
  it("reads the current members of the space", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
    });
    expect(await loadMembers(api, { spaceId: "sp-household", canInvite: false })).toEqual({
      ok: true,
      data: { members: [memberDto()], invitations: null },
    });
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/api/v1/spaces/sp-household/members"]);
  });

  it("reads the pending invitations only for someone who may invite (ruling P155)", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
      "GET /api/v1/spaces/{spaceId}/invitations": () => jsonResponse({ items: [invitationDto()] }),
    });
    expect(await loadMembers(api, { spaceId: "sp-household", canInvite: true })).toMatchObject({
      ok: true,
      data: { invitations: [invitationDto()] },
    });
    expect(await loadMembers(api, { spaceId: "sp-household", canInvite: false })).toMatchObject({
      ok: true,
      data: { invitations: null },
    });
    expect(requests.filter((r) => r.url.endsWith("/invitations"))).toHaveLength(1);
  });
});
