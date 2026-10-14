import { describe, expect, it } from "vitest";
import type { Id } from "@/shared/kernel";
import {
  checkedPeriodPolicy,
  createPersonalSpace,
  createSharedSpace,
  ensureArchivable,
  ensureCanAddMember,
  ensureMembersCanChange,
  spaceName,
} from "./space";

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

describe("shared space (HU-E1-04)", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const shared = (name: string, currency = "COP") =>
    createSharedSpace({
      id: "s-2" as Id<"Space">,
      memberId: "m-2" as Id<"SpaceMember">,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      name,
      currency,
      now,
    });

  it("is SHARED, trimmed, in MONTHLY(1), with its creator as the only OWNER", () => {
    const result = shared("  Household ");
    expect(result.ok && result.value).toMatchObject({
      kind: "SHARED",
      name: "Household",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      personalOwnerUserId: null,
    });
    expect(result.ok && result.value.members).toEqual([
      {
        id: "m-2",
        kind: "USER",
        userId: "u-ana",
        displayName: "Ana",
        role: "OWNER",
        contactEmail: null,
        joinedAt: now,
      },
    ]);
  });

  it("requires a name", () => {
    const result = shared("   ");
    expect(!result.ok && result.error.code).toBe("InvalidSpaceName");
  });

  it("rejects currencies the kernel does not support", () => {
    const result = shared("Household", "XYZ");
    expect(!result.ok && result.error.code).toBe("UnknownCurrency");
  });

  it("can receive members", () => {
    expect(ensureCanAddMember({ kind: "SHARED" })).toEqual({ ok: true, value: undefined });
  });
});

describe("membership changes (HU-E1-08, HU-E1-12, D16)", () => {
  it("happen in shared spaces only", () => {
    expect(ensureMembersCanChange({ kind: "SHARED" })).toEqual({ ok: true, value: undefined });
    const personal = ensureMembersCanChange({ kind: "PERSONAL" });
    expect(!personal.ok && personal.error.code).toBe("PersonalSpaceNotShareable");
    const direct = ensureMembersCanChange({ kind: "DIRECT" });
    expect(!direct.ok && direct.error.code).toBe("DirectSpaceMembersFixed");
  });
});

describe("direct space (HU-E1-13, D16)", () => {
  it("cannot get a third member", () => {
    const result = ensureCanAddMember({ kind: "DIRECT" });
    expect(!result.ok && result.error.code).toBe("DirectSpaceIsFull");
  });
});

describe("archiving (HU-E1-09)", () => {
  it("is for shared and direct spaces, never personal ones", () => {
    expect(ensureArchivable({ kind: "SHARED" })).toEqual({ ok: true, value: undefined });
    expect(ensureArchivable({ kind: "DIRECT" })).toEqual({ ok: true, value: undefined });
    const personal = ensureArchivable({ kind: "PERSONAL" });
    expect(!personal.ok && personal.error.code).toBe("PersonalSpaceNotArchivable");
  });
});
