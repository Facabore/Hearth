import { describe, expect, it } from "vitest";
import { NO_ATTRIBUTES, switchesOf, type AccountId, type AccountType } from "./account";
import { totalsOf } from "./account-totals";

const at = new Date("2026-10-16T12:00:00Z");
const held = (name: string, type: AccountType, pesos: number) => ({
  ...NO_ATTRIBUTES,
  id: `acc-${name}` as AccountId,
  spaceId: "space-ana",
  name,
  type,
  ownerUserId: "u-ana",
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
    expect(totalsOf(ana)).toEqual({ available: 230_000_000n, netWorth: 395_000_000n });
  });

  it("turns available off for a type that counts in it by default, and keeps it in net worth", () => {
    const withoutBank = ana.map((a) => (a.name === "Bancolombia" ? { ...a, includeInAvailable: false } : a));
    expect(totalsOf(withoutBank)).toEqual({ available: 30_000_000n, netWorth: 395_000_000n });
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
    expect(totalsOf(switched)).toEqual({ available: 1_230_000_000n, netWorth: 365_000_000n });
    const archived = ana.map((a) => (a.name === "Nequi" ? { ...a, archivedAt: at } : a));
    expect(totalsOf(archived)).toEqual({ available: 200_000_000n, netWorth: 365_000_000n });
  });
});
