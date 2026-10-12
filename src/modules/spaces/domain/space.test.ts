import { describe, expect, it } from "vitest";
import type { Id } from "@/shared/kernel";
import { checkedPeriodPolicy, createPersonalSpace, ensureCanAddMember, spaceName } from "./space";

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

describe("space settings rules (HU-E1-03)", () => {
  it("trims names and rejects blank or overlong ones", () => {
    expect(spaceName("  Casa  ")).toEqual({ ok: true, value: "Casa" });
    for (const bad of ["   ", "x".repeat(81)]) {
      const result = spaceName(bad);
      expect(!result.ok && result.error.code).toBe("InvalidSpaceName");
    }
  });

  it.each([
    { kind: "MONTHLY", day: 0 },
    { kind: "MONTHLY", day: 32 },
    { kind: "SEMI_MONTHLY", day1: 20, day2: 5 },
  ] as const)("rejects the period policy %o", (policy) => {
    const result = checkedPeriodPolicy(policy);
    expect(!result.ok && result.error.code).toBe("InvalidPeriodPolicy");
  });

  it("accepts valid policies unchanged", () => {
    expect(checkedPeriodPolicy({ kind: "SEMI_MONTHLY", day1: 5, day2: 20 })).toEqual({
      ok: true,
      value: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 },
    });
  });
});
