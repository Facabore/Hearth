import { describe, expect, it } from "vitest";
import type { Id, Result } from "@/shared/kernel";
import { createDirectSpace, directPairKey, pairKeyOf, type DirectCounterpart } from "./direct-space";
import { createSharedSpace } from "./space";

const now = new Date("2026-10-14T12:00:00Z");
const code = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);
const direct = (counterpart: DirectCounterpart, creatorName = "Ana", currency = "COP") =>
  createDirectSpace({
    id: "s-direct" as Id<"Space">,
    creatorMemberId: "m-ana" as Id<"SpaceMember">,
    counterpartMemberId: "m-other" as Id<"SpaceMember">,
    creatorUserId: "u-ana",
    creatorName,
    counterpart,
    currency,
    now,
  });
const pedro: DirectCounterpart = { kind: "GUEST", displayName: "Pedro", contactEmail: null };
const juan: DirectCounterpart = { kind: "USER", userId: "u-juan", displayName: "Juan" };

describe("direct spaces (HU-E1-13, D16)", () => {
  it("are DIRECT, named after both, in MONTHLY(1), with the creator as OWNER and the guest", () => {
    expect(direct(pedro)).toEqual({
      ok: true,
      value: {
        id: "s-direct",
        name: "Ana & Pedro",
        kind: "DIRECT",
        currency: "COP",
        periodPolicy: { kind: "MONTHLY", day: 1 },
        personalOwnerUserId: null,
        members: [
          {
            id: "m-ana",
            kind: "USER",
            userId: "u-ana",
            displayName: "Ana",
            role: "OWNER",
            contactEmail: null,
            joinedAt: now,
          },
          {
            id: "m-other",
            kind: "GUEST",
            userId: null,
            displayName: "Pedro",
            role: null,
            contactEmail: null,
            joinedAt: now,
          },
        ],
        createdAt: now,
      },
    });
  });

  it("make a registered counterpart an OWNER too, numbering a name the creator already uses", () => {
    const result = direct({ kind: "USER", userId: "u-ana-2", displayName: "Ana" });
    expect(result.ok && result.value.name).toBe("Ana & Ana 2");
    expect(result.ok && result.value.members.map((m) => [m.userId, m.displayName, m.role])).toEqual([
      ["u-ana", "Ana", "OWNER"],
      ["u-ana-2", "Ana 2", "OWNER"],
    ]);
  });

  it("join a registered counterpart as a USER member with no contact email, at the same instant", () => {
    const result = direct(juan);
    expect(result.ok && result.value.members[1]).toEqual({
      id: "m-other",
      kind: "USER",
      userId: "u-juan",
      displayName: "Juan",
      role: "OWNER",
      contactEmail: null,
      joinedAt: now,
    });
  });

  it("cut their name to the 80 characters of a space name (Review Focus 3)", () => {
    const result = direct(
      { kind: "GUEST", displayName: "P".repeat(100), contactEmail: null },
      "A".repeat(60),
    );
    expect(result.ok && result.value.name).toBe(`${"A".repeat(60)} & ${"P".repeat(17)}`);
  });

  it("refuse a guest named like the creator and a currency the kernel does not know (Review Focus 3)", () => {
    expect(code(direct({ kind: "GUEST", displayName: "ana", contactEmail: null }))).toBe("MemberNameTaken");
    expect(code(direct(pedro, "Ana", "XYZ"))).toBe("UnknownCurrency");
  });

  it("key a pair of registered users the same in either order, and no pair while one side is a guest", () => {
    expect(pairKeyOf("u-juan", "u-ana")).toBe("u-ana:u-juan");
    expect(pairKeyOf("u-ana", "u-juan")).toBe("u-ana:u-juan");
    const withJuan = direct(juan);
    const withPedro = direct(pedro);
    expect(withJuan.ok && directPairKey(withJuan.value)).toBe("u-ana:u-juan");
    expect(withPedro.ok && directPairKey(withPedro.value)).toBeNull();
  });

  it("key no shared space", () => {
    const shared = createSharedSpace({
      id: "s-shared" as Id<"Space">,
      memberId: "m-ana" as Id<"SpaceMember">,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      name: "Household",
      currency: "COP",
      now,
    });
    expect(shared.ok && directPairKey(shared.value)).toBeNull();
    // Two registered members are not enough: only the DIRECT kind is keyed.
    const withJuan = direct(juan);
    expect(withJuan.ok && directPairKey({ kind: "SHARED", members: withJuan.value.members })).toBeNull();
  });

  it("key no direct space that is not exactly a pair", () => {
    const withJuan = direct(juan);
    const members = withJuan.ok ? withJuan.value.members : [];
    const third = { ...members[0]!, id: "m-third" as Id<"SpaceMember">, userId: "u-third" };
    expect(directPairKey({ kind: "DIRECT", members: [...members, third] })).toBeNull();
    expect(directPairKey({ kind: "DIRECT", members: members.slice(0, 1) })).toBeNull();
  });

  it("never end a cut name with a space", () => {
    const result = direct({ kind: "GUEST", displayName: "Pedro", contactEmail: null }, "A".repeat(77));
    expect(result.ok && result.value.name).toBe(`${"A".repeat(77)} &`);
  });
});
