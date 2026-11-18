import { describe, expect, it } from "vitest";
import { formatApproximateMoney } from "./approximate";
import { BUILT_IN_FORMATS } from "./formatters";

describe("an approximate amount (D29, slice MC4, board 8)", () => {
  it("writes ≈ and the amount as one unbreakable run", () => {
    expect(formatApproximateMoney({ amount: "357044000", currency: "COP" }, BUILT_IN_FORMATS)).toBe(
      "≈\u00a03.570.440\u00a0COP",
    );
  });
});
