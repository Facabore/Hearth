import { describe, expect, it } from "vitest";
import { lineStateOf } from "./line-state";

describe("a line's state (#142, ruling P244 of M6c)", () => {
  it("is OK below 80 % used, NEAR from 80 % through 90 %, HIGH above 90 % up to the whole budget, OVER past it", () => {
    const budget = 100_000_000n;
    expect([
      lineStateOf(budget, 20_000_001n),
      lineStateOf(budget, 20_000_000n),
      lineStateOf(budget, 10_000_000n),
      lineStateOf(budget, 9_999_999n),
      lineStateOf(budget, 0n),
      lineStateOf(budget, -1n),
    ]).toEqual(["OK", "NEAR", "NEAR", "HIGH", "HIGH", "OVER"]);
  });

  it("is OK for an empty budget nothing was spent from, and OVER for one that was spent from", () => {
    expect([lineStateOf(0n, 0n), lineStateOf(0n, -1n), lineStateOf(-5n, -5n)]).toEqual([
      "OK",
      "OVER",
      "OVER",
    ]);
  });
});
