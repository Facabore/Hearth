import { describe, expect, it } from "vitest";
import type { Id } from "@/shared/kernel";
import {
  checkedPeriodPolicy,
  createPersonalSpace,
  createSharedSpace,
  ensureArchivable,
  ensureCanAddMember,
  ensureMembersCanChange,
  spaceColor,
  checkedSpaceColor,
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

describe("space color (ruling P306)", () => {
  it("shows the color a manager chose", () => {
    expect(spaceColor("s-1", "PLUM")).toBe("PLUM");
    expect(spaceColor("s-1", "GRAPHITE")).toBe("GRAPHITE");
  });

  it("derives one from the id until then: the same for the same space, never GRAPHITE, and spread over the palette", () => {
    const ids = Array.from(
      { length: 300 },
      (_, i) => `7f0c${i.toString(16).padStart(4, "0")}-0000-4000-8000-000000000000`,
    );
    const colors = ids.map((id) => spaceColor(id, null));
    expect(colors).toEqual(ids.map((id) => spaceColor(id, null)));
    expect(colors).not.toContain("GRAPHITE");
    expect(new Set(colors).size).toBe(15);
  });

  it("accepts only the palette's keys", () => {
    expect(checkedSpaceColor("SKY")).toEqual({ ok: true, value: "SKY" });
    expect(checkedSpaceColor("PINK")).toMatchObject({ ok: false, error: { code: "InvalidSpaceColor" } });
  });
});
