import { describe, expect, it } from "vitest";
import { accountDto } from "../../../../tests/support/ui/dto";
import { colorOf, rateText, sectionsOf } from "./account-sections";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";

describe("account sections (HU-E9-03, ruling P131)", () => {
  it("groups active accounts by type in the screen's order and sets archived ones apart", () => {
    const items = [
      accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD" }),
      accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" }),
      accountDto({ id: "a-old", name: "Old wallet", type: "WALLET", archivedAt: "2026-10-01T12:00:00.000Z" }),
      accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET" }),
    ];
    const { active, archived } = sectionsOf(items);
    expect(active.map((s) => [s.key, s.accounts.map((a) => a.name)])).toEqual([
      ["everyday", ["Bancolombia", "Nequi"]],
      ["cards", ["Visa"]],
    ]);
    expect(archived.map((a) => a.name)).toEqual(["Old wallet"]);
  });

  it("places every account type in its section", () => {
    const types = [
      "CASH",
      "BANK",
      "WALLET",
      "CREDIT_CARD",
      "SAVINGS",
      "INVESTMENT",
      "LOAN",
      "OTHER",
      "SHARED_FUND",
    ] as const;
    const { active } = sectionsOf(types.map((type) => accountDto({ id: `a-${type}`, name: type, type })));
    expect(active.map((s) => [s.key, s.accounts.map((a) => a.type)])).toEqual([
      ["everyday", ["CASH", "BANK", "WALLET"]],
      ["cards", ["CREDIT_CARD"]],
      ["savings", ["SAVINGS", "INVESTMENT"]],
      ["debts", ["LOAN"]],
      ["other", ["OTHER"]],
      ["funds", ["SHARED_FUND"]],
    ]);
  });

  it("takes the account's color, else its type's, and writes rates in the number format", () => {
    expect(colorOf(accountDto({ type: "BANK", color: null }))).toBe("STEEL");
    expect(colorOf(accountDto({ type: "BANK", color: "ROSE" }))).toBe("ROSE");
    expect(rateText("11.2000", BUILT_IN_FORMATS)).toBe("11,2");
    expect(rateText("1.8900", { ...BUILT_IN_FORMATS, numberFormat: "COMMA_DOT" })).toBe("1.89");
  });

  it("gives every account type without a color the look the artboard draws", () => {
    const types = [
      "CASH",
      "BANK",
      "WALLET",
      "CREDIT_CARD",
      "SAVINGS",
      "INVESTMENT",
      "LOAN",
      "OTHER",
      "SHARED_FUND",
    ] as const;
    expect(
      Object.fromEntries(types.map((type) => [type, colorOf(accountDto({ type, color: null }))])),
    ).toEqual({
      CASH: "PINE",
      BANK: "STEEL",
      WALLET: "PINE",
      CREDIT_CARD: "PLUM",
      SAVINGS: "SAND",
      INVESTMENT: "SAND",
      LOAN: "EMBER",
      OTHER: "GRAPHITE",
      SHARED_FUND: "TEAL",
    });
  });
});
