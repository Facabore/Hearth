import { describe, expect, it } from "vitest";
import { guestDto, memberDto } from "../../../../../tests/support/ui/dto";
import { memberLabel } from "./member-label";

const t = (key: "you" | "guestSuffix", values?: { name: string }) =>
  key === "you" ? `${values!.name} (tú)` : "(invitado)";

describe("memberLabel (HU-E9-05)", () => {
  it("marks the viewer and the guests, and leaves the others as they are", () => {
    expect(memberLabel(memberDto(), "u-ana", t)).toBe("Ana (tú)");
    expect(memberLabel(guestDto(), "u-ana", t)).toBe("Pedro (invitado)");
    expect(memberLabel(memberDto({ userId: "u-juan", displayName: "Juan" }), "u-ana", t)).toBe("Juan");
  });
});
