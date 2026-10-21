import { describe, expect, it } from "vitest";
import { invitationOf } from "./invitation";

describe("invitationOf (ruling P147)", () => {
  it("reads one non-empty token and nothing else", () => {
    expect(invitationOf("tok-123")).toBe("tok-123");
    expect(invitationOf("")).toBeUndefined();
    expect(invitationOf(["a", "b"])).toBeUndefined();
    expect(invitationOf(undefined)).toBeUndefined();
  });
});
