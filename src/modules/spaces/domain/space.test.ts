import { describe, expect, it } from "vitest";
import type { Id } from "@/shared/kernel";
import { createPersonalSpace, ensureCanAddMember } from "./space";

const space = createPersonalSpace({
  id: "s-1" as Id<"Space">,
  memberId: "m-1" as Id<"SpaceMember">,
  ownerUserId: "u-ana",
  ownerName: "Ana",
  now: new Date("2026-10-11T12:00:00Z"),
});

describe("personal space", () => {
  it("is PERSONAL, in COP, with MONTHLY(1) and Ana as its only OWNER", () => {
    expect(space).toMatchObject({
      kind: "PERSONAL",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
    });
    expect(space.members).toEqual([
      expect.objectContaining({ kind: "USER", userId: "u-ana", displayName: "Ana", role: "OWNER" }),
    ]);
  });

  it("cannot receive members", () => {
    const result = ensureCanAddMember(space);
    expect(!result.ok && result.error.code).toBe("PersonalSpaceNotShareable");
  });
});
