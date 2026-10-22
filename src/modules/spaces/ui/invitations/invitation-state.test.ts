import { describe, expect, it } from "vitest";
import { pageStateOf } from "./invitation-state";

describe("pageStateOf (HU-E9-05, ruling P165)", () => {
  it.each([
    ["PENDING", false, "visitor"],
    ["PENDING", true, "signedIn"],
    ["EXPIRED", true, "expired"],
    ["REVOKED", false, "revoked"],
    ["ACCEPTED", true, "used"],
    [null, true, "missing"],
  ] as const)("%s, signed in %s → %s", (status, signedIn, state) => {
    expect(pageStateOf(status, signedIn)).toBe(state);
  });
});
