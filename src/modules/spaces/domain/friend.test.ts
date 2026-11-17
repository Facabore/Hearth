import { describe, expect, it } from "vitest";
import { directPeer, friendName, friendNickname, guestNickname } from "./friend";
import type { SpaceMember, SpaceMemberId } from "./space";

const member = (id: string, kind: "USER" | "GUEST", displayName: string): SpaceMember => ({
  id: id as SpaceMemberId,
  kind,
  userId: kind === "USER" ? `u-${id}` : null,
  displayName,
  role: kind === "USER" ? "OWNER" : null,
  contactEmail: null,
  joinedAt: new Date("2026-10-01T12:00:00Z"),
});
const codeOf = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? null : result.error!.code);

describe("an apodo (P338)", () => {
  it("is trimmed and 1 to 40 characters long; null clears it", () => {
    expect(friendNickname("  Juancho ")).toEqual({ ok: true, value: "Juancho" });
    expect(friendNickname("x".repeat(40))).toEqual({ ok: true, value: "x".repeat(40) });
    expect(friendNickname(null)).toEqual({ ok: true, value: null });
    expect(codeOf(friendNickname("   "))).toBe("InvalidNickname");
    expect(codeOf(friendNickname("x".repeat(41)))).toBe("InvalidNickname");
  });

  it("for a guest is its name, so it cannot be cleared", () => {
    expect(guestNickname(" Pedrito ")).toEqual({ ok: true, value: "Pedrito" });
    expect(codeOf(guestNickname(null))).toBe("InvalidNickname");
  });

  it("names a registered person by the viewer's alias, and a guest always by its name", () => {
    expect(friendName(member("juan", "USER", "Juan"), "Juancho")).toMatchObject({
      other: { kind: "USER", displayName: "Juan", nickname: "Juancho" },
      name: "Juancho",
    });
    expect(friendName(member("juan", "USER", "Juan"), null).name).toBe("Juan");
    expect(friendName(member("pedro", "GUEST", "Pedro"), "stale alias")).toMatchObject({
      other: { nickname: null },
      name: "Pedro",
    });
  });

  it("belongs to the one member of the direct space who is not the viewer", () => {
    const ana = member("ana", "USER", "Ana");
    const pedro = member("pedro", "GUEST", "Pedro");
    expect(directPeer([ana, pedro], "ana")).toBe(pedro);
    expect(directPeer([ana], "ana")).toBeUndefined();
  });
});
