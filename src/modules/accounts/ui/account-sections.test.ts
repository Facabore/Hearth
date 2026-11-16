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
    const { active, archived } = sectionsOf(items, "COP");
    expect(active.map((s) => [s.key, s.accounts.map((a) => a.name)])).toEqual([
      ["everyday", ["Bancolombia", "Nequi"]],
      ["cards", ["Visa"]],
    ]);
    expect(archived.map((a) => a.name)).toEqual(["Old wallet"]);
  });

  it("lists accounts in another currency apart, grouped by currency and out of the type sections (D29, slice MC3)", () => {
    const usd = (dollars: number) => ({ amount: String(dollars * 100), currency: "USD" });
    const eur = (euros: number) => ({ amount: String(euros * 100), currency: "EUR" });
    const items = [
      accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" }),
      accountDto({ id: "a-chase", name: "Chase", type: "BANK", balance: usd(1_000) }),
      accountDto({ id: "a-n26", name: "N26", type: "WALLET", balance: eur(50) }),
      accountDto({ id: "a-schwab", name: "Schwab", type: "SAVINGS", balance: usd(500) }),
    ];
    const { active, foreign } = sectionsOf(items, "COP");
    // Only the COP account stays in a type section.
    expect(active.map((s) => [s.key, s.accounts.map((a) => a.name)])).toEqual([
      ["everyday", ["Bancolombia"]],
    ]);
    // The others are grouped by currency, sorted by code.
    expect(foreign.map((g) => [g.currency, g.accounts.map((a) => a.name)])).toEqual([
      ["EUR", ["N26"]],
      ["USD", ["Chase", "Schwab"]],
    ]);
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
    const { active } = sectionsOf(
      types.map((type) => accountDto({ id: `a-${type}`, name: type, type })),
      "COP",
    );
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
