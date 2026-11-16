import { describe, expect, it } from "vitest";
import { ExchangeRate, type LocalDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { NO_ATTRIBUTES, switchesOf, type AccountId, type AccountType } from "./account";
import { convertedTotalsOf, totalsOf } from "./account-totals";

const at = new Date("2026-10-16T12:00:00Z");
const on = (iso: string) => iso as LocalDate;
const held = (name: string, type: AccountType, pesos: number, currency = "COP") => ({
  ...NO_ATTRIBUTES,
  id: `acc-${name}` as AccountId,
  spaceId: "space-ana",
  name,
  type,
  ownerUserId: "u-ana",
  currency,
  openingBalance: 0n,
  archivedAt: null,
  createdAt: at,
  balance: BigInt(pesos) * 100n,
});
const ana = [
  held("Bancolombia", "BANK", 2_000_000),
  held("Nequi", "WALLET", 300_000),
  held("Visa", "CREDIT_CARD", -350_000),
  held("CDT", "SAVINGS", 10_000_000),
  held("Loan", "LOAN", -8_000_000),
];

describe("available money and net worth (HU-E2-07)", () => {
  it("defaults by type: CASH, BANK, WALLET and SHARED_FUND count in both, the rest in net worth only", () => {
    const types = [
      "CASH",
      "BANK",
      "WALLET",
      "SHARED_FUND",
      "CREDIT_CARD",
      "SAVINGS",
      "INVESTMENT",
      "LOAN",
      "OTHER",
    ] as const;
    expect(
      types.map(
        (type) => switchesOf({ type, includeInAvailable: null, includeInNetWorth: null }).includeInAvailable,
      ),
    ).toEqual([true, true, true, true, false, false, false, false, false]);
    expect(
      types.every(
        (type) => switchesOf({ type, includeInAvailable: null, includeInNetWorth: null }).includeInNetWorth,
      ),
    ).toBe(true);
  });

  it("totals 2,300,000 available and 3,950,000 net worth with the default switches (@critical)", () => {
    expect(totalsOf(ana, "COP")).toEqual({ available: 230_000_000n, netWorth: 395_000_000n });
  });

  it("leaves accounts not in the space currency out of the space totals (D29, slice MC3)", () => {
    const mixed = [...ana, held("Chase", "BANK", 500_000, "USD"), held("Loan USD", "LOAN", -200_000, "USD")];
    // The USD accounts add nothing to COP totals until MC4 converts them.
    expect(totalsOf(mixed, "COP")).toEqual({ available: 230_000_000n, netWorth: 395_000_000n });
  });

  it("turns available off for a type that counts in it by default, and keeps it in net worth", () => {
    const withoutBank = ana.map((a) => (a.name === "Bancolombia" ? { ...a, includeInAvailable: false } : a));
    expect(totalsOf(withoutBank, "COP")).toEqual({ available: 30_000_000n, netWorth: 395_000_000n });
    expect(switchesOf({ type: "BANK", includeInAvailable: false, includeInNetWorth: null })).toEqual({
      includeInAvailable: false,
      includeInNetWorth: true,
    });
  });

  it("follows the switches and leaves archived accounts out", () => {
    const switched = ana.map((a) =>
      a.name === "CDT"
        ? { ...a, includeInAvailable: true }
        : a.name === "Nequi"
          ? { ...a, includeInNetWorth: false }
          : a,
    );
    expect(totalsOf(switched, "COP")).toEqual({ available: 1_230_000_000n, netWorth: 365_000_000n });
    const archived = ana.map((a) => (a.name === "Nequi" ? { ...a, archivedAt: at } : a));
    expect(totalsOf(archived, "COP")).toEqual({ available: 200_000_000n, netWorth: 365_000_000n });
  });
});

describe("totals converted on read (D29, slice MC4, board 8)", () => {
  const usdCop = {
    rate: unwrap(ExchangeRate.of("USD", "COP", "4100")),
    date: on("2026-11-15"),
    stale: false,
  };
  const space = [
    held("Bancolombia", "BANK", 1_469_600),
    { ...held("Dolares", "BANK", 0, "USD"), balance: 51_240n },
  ];

  it("converts an account in another currency at its rate and says which rate and day it used", () => {
    const { totals, conversion } = convertedTotalsOf(space, "COP", new Map([["USD", usdCop]]));
    // US$ 512,40 at 4.100 is $ 2.100.840; with $ 1.469.600 the available money is ≈ $ 3.570.440.
    expect(totals).toEqual({ available: 357_044_000n, netWorth: 357_044_000n });
    expect(conversion.converted).toEqual(new Map([["acc-Dolares", 210_084_000n]]));
    expect(conversion.rates).toEqual([
      { currency: "USD", rate: usdCop.rate, unit: 410_000n, date: "2026-11-15", stale: false },
    ]);
    expect(conversion.withoutRate).toEqual([]);
  });

  it("leaves an account with no rate out of the totals and flags it, never counting it at 1:1", () => {
    const { totals, conversion } = convertedTotalsOf(space, "COP", new Map());
    expect(totals).toEqual({ available: 146_960_000n, netWorth: 146_960_000n });
    expect(conversion).toEqual({ converted: new Map(), rates: [], withoutRate: ["acc-Dolares"] });
  });

  it("keeps a stale rate, flagged", () => {
    const old = { ...usdCop, date: on("2026-11-05"), stale: true };
    const { conversion } = convertedTotalsOf(space, "COP", new Map([["USD", old]]));
    expect(conversion.rates.map((r) => [r.date, r.stale])).toEqual([["2026-11-05", true]]);
  });

  it("converts nothing, and asks no rate, when every account is in the space's currency", () => {
    expect(convertedTotalsOf(ana, "COP", new Map()).conversion).toEqual({
      converted: new Map(),
      rates: [],
      withoutRate: [],
    });
  });
});
