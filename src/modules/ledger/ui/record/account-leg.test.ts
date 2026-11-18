import { describe, expect, it } from "vitest";
import { suggestedLeg } from "./account-leg";

describe("suggestedLeg (P342, board 4)", () => {
  it("converts 50 USD at 4100 into 205.000 COP", () =>
    expect(suggestedLeg("5000", "USD", "COP", "4100")).toBe("20500000"));

  it("rounds half to even at the target's minor unit, as Money.convert does", () => {
    // 0,01 USD at 4100.255 is 41,00255 COP → 41,00; 5 and 7 cents at 0.5 are 2,5 and 3,5 cents → 2 and 4.
    expect(suggestedLeg("1", "USD", "COP", "4100.255")).toBe("4100");
    expect(suggestedLeg("5", "USD", "EUR", "0.5")).toBe("2");
    expect(suggestedLeg("7", "USD", "EUR", "0.5")).toBe("4");
  });

  it("follows each currency's exponent (JPY has none)", () =>
    expect(suggestedLeg("1000", "USD", "JPY", "150")).toBe("1500"));

  it("refuses a rate that is not a plain positive decimal", () => {
    expect(suggestedLeg("5000", "USD", "COP", "0")).toBeNull();
    expect(suggestedLeg("5000", "USD", "COP", "-1")).toBeNull();
    expect(suggestedLeg("5000", "USD", "COP", "1e3")).toBeNull();
  });
});
