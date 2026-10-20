import { describe, expect, it } from "vitest";
import { ACCOUNT_COLORS, ACCOUNT_ICONS } from "@/modules/accounts/domain/account";
import { CATEGORY_COLORS, CATEGORY_SYMBOLS } from "@/modules/categories/domain/category-style";
import { PALETTE, SYMBOLS } from "./style";

describe("the shared style vocabulary (#125, ruling P122)", () => {
  it("is one palette of sixteen keys for categories and accounts", () => {
    expect(PALETTE).toHaveLength(16);
    expect(CATEGORY_COLORS).toBe(PALETTE);
    expect(ACCOUNT_COLORS).toBe(PALETTE);
  });

  it("names every symbol once, alphabetically, and both allow-lists are subsets", () => {
    expect([...SYMBOLS]).toEqual([...SYMBOLS].sort());
    expect(new Set(SYMBOLS).size).toBe(61);
    expect(SYMBOLS.filter((name) => !(CATEGORY_SYMBOLS as readonly string[]).includes(name))).toEqual([
      "cash",
      "trend",
      "wallet",
    ]);
    expect(ACCOUNT_ICONS.every((name) => (SYMBOLS as readonly string[]).includes(name))).toBe(true);
    expect(ACCOUNT_ICONS).toHaveLength(16);
  });
});
