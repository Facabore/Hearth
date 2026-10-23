import { describe, expect, it } from "vitest";
import { originOf } from "./origin";

describe("originOf: where an edit returns (ruling P191)", () => {
  it.each([
    ["/spaces/s-1/transactions?period=2026-10", "/spaces/s-1/transactions?period=2026-10"],
    ["/spaces/s-1", "/spaces/s-1"],
    ["/spaces/s-1/transactions?tx=t-1", "/spaces/s-1/transactions"],
    ["/spaces/s-1/transactions?period=2026-10&tx=t-1", "/spaces/s-1/transactions?period=2026-10"],
    [undefined, "/spaces/s-1/transactions"],
    ["", "/spaces/s-1/transactions"],
    ["https://evil.example/spaces/s-1", "/spaces/s-1/transactions"],
    ["//evil.example", "/spaces/s-1/transactions"],
    ["/spaces/s-2/transactions", "/spaces/s-1/transactions"],
    ["/spaces/s-10/transactions", "/spaces/s-1/transactions"],
    ["/spaces/s-1/../s-2/transactions", "/spaces/s-1/transactions"],
    ["/settings", "/spaces/s-1/transactions"],
    ["/sign-in", "/spaces/s-1/transactions"],
    ["/api/v1/me", "/spaces/s-1/transactions"],
  ])("from %s returns to %s", (returnTo, expected) => expect(originOf(returnTo, "s-1")).toBe(expected));
});
