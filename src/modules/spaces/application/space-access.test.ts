import { describe, expect, it } from "vitest";
import { codeOf, fakeSpaceAccess, membership, unwrap } from "../../../../tests/support/fakes";
import { authorizeSpaceAction, MANAGERS, requirePermission, WRITERS } from "./space-access";

const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
const luis = membership({ ...household, memberId: "member-luis", userId: "u-luis", role: "MEMBER" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });
const access = fakeSpaceAccess(household, luis, sofi);

describe("role sets derived from the permission matrix", () => {
  it("keeps the managers and writers M1 authorizes with", () => {
    expect(MANAGERS).toEqual(["OWNER", "ADMIN"]);
    expect(WRITERS).toEqual(["OWNER", "ADMIN", "MEMBER"]);
  });
});

describe("AuthorizeSpaceAction (HU-E1-05)", () => {
  it("returns the membership when the role allows the action", async () => {
    expect(unwrap(await authorizeSpaceAction(access, "space-household", "u-luis", "guest.add"))).toBe(luis);
  });

  it("answers InsufficientRole when it does not", async () => {
    expect(codeOf(await authorizeSpaceAction(access, "space-household", "u-sofi", "guest.add"))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(requirePermission(luis, "member.invite"))).toBe("InsufficientRole");
  });

  it("answers SpaceNotFound to non-members before looking at roles", async () => {
    expect(codeOf(await authorizeSpaceAction(access, "space-household", "u-marta", "space.read"))).toBe(
      "SpaceNotFound",
    );
  });
});
