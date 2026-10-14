import { describe, expect, it } from "vitest";
import { codeOf, fakeSpaceAccess, membership, unwrap } from "../../../../tests/support/fakes";
import { householdSpace, InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
import { SPACE_ACTIONS } from "../domain/permissions";
import type { SpaceRole } from "../domain/space";
import {
  authorizeSpaceAction,
  createSpaceAccess,
  MANAGERS,
  requirePermission,
  WRITERS,
} from "./space-access";

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

describe("archived spaces only read (HU-E1-09, Review Focus 4)", () => {
  const household = (archived: boolean) => {
    const store = new InMemorySpaceStore();
    store.seed(householdSpace());
    if (archived) store.archived.add("space-household");
    return createSpaceAccess(store);
  };
  const archivedHousehold = () => household(true);
  /** One Household member per role (HU-E1-05 Background); `satisfies` makes a new role fail to compile here. */
  const MEMBER_OF_ROLE = {
    OWNER: "u-ana",
    ADMIN: "u-juan",
    MEMBER: "u-luis",
    VIEWER: "u-sofi",
  } as const satisfies Record<SpaceRole, string>;
  const ROLES = Object.keys(MEMBER_OF_ROLE) as SpaceRole[];

  it("refuses every action but reading with SpaceArchived, whatever the role, before the role is checked", async () => {
    const access = archivedHousehold();
    for (const role of ROLES) {
      for (const action of SPACE_ACTIONS.filter((a) => a !== "space.read")) {
        // Also the actions this role lacks: the archive check comes first, so a VIEWER's write is not InsufficientRole.
        expect([
          role,
          action,
          codeOf(await authorizeSpaceAction(access, "space-household", MEMBER_OF_ROLE[role], action)),
        ]).toEqual([role, action, "SpaceArchived"]);
      }
    }
  });

  it("lets every role read an archived space, which reports it as archived", async () => {
    const access = archivedHousehold();
    for (const role of ROLES) {
      const read = await authorizeSpaceAction(access, "space-household", MEMBER_OF_ROLE[role], "space.read");
      expect([role, unwrap(read).archived]).toEqual([role, true]);
    }
  });

  it("keeps the role check for active spaces, so SpaceArchived is the archive and not a missing role", async () => {
    const active = household(false);
    expect(codeOf(await authorizeSpaceAction(active, "space-household", "u-sofi", "money.record"))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await authorizeSpaceAction(active, "space-household", "u-luis", "money.record"))).toBe(
      "ok",
    );
    const archived = archivedHousehold();
    expect(codeOf(await authorizeSpaceAction(archived, "space-household", "u-sofi", "money.record"))).toBe(
      "SpaceArchived",
    );
    expect(codeOf(await authorizeSpaceAction(archived, "space-household", "u-luis", "money.record"))).toBe(
      "SpaceArchived",
    );
  });

  it("refuses direct access, which write paths use too, unless the caller only reads", async () => {
    const access = archivedHousehold();
    expect(codeOf(await access("space-household", "u-ana"))).toBe("SpaceArchived");
    expect(codeOf(await access("space-household", "u-ana", { readOnly: true }))).toBe("ok");
  });

  it("answers SpaceNotFound to a non-member of an archived space, for writes and reads alike", async () => {
    const access = archivedHousehold();
    expect(codeOf(await access("space-household", "u-marta"))).toBe("SpaceNotFound");
    expect(codeOf(await access("space-household", "u-marta", { readOnly: true }))).toBe("SpaceNotFound");
  });
});
