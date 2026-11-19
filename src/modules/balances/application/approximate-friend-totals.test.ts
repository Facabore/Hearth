import { describe, expect, it } from "vitest";
import {
  createApproximateFriendTotals,
  type ApproximateToday,
  type CurrencyAmount,
} from "./approximate-friend-totals";

/** Today's rates into COP for the test: USD at 4.000, EUR at 4.400; any other currency has none. */
const RATES: Record<string, bigint> = { COP: 1n, USD: 4_000n, EUR: 4_400n };

/** Stands in for reporting's approximation, bound in composition: the person's currency at today's rate. */
const approximateInPesos = (calls: (readonly CurrencyAmount[])[] = []): ApproximateToday => {
  return async (_userId, amounts) => {
    calls.push(amounts);
    const parts = amounts.map(({ currency, amount }) => ({
      currency,
      amount,
      value: RATES[currency] === undefined ? null : amount * RATES[currency]!,
    }));
    return {
      currency: "COP",
      total: parts.reduce((sum, part) => sum + (part.value ?? 0n), 0n),
      parts,
    };
  };
};

const friend = (...nets: [string, bigint][]) => ({
  nets: nets.map(([currency, net]) => ({ currency, net })),
});

describe("Amigos' approximate totals (P342, S6)", () => {
  it("adds what everyone owes her and what she owes in COP at today's rate, each side apart", async () => {
    const calls: (readonly CurrencyAmount[])[] = [];
    const totals = createApproximateFriendTotals({ approximate: approximateInPesos(calls) });
    const approximate = await totals("u-ana", [
      friend(["COP", 500_000_00n], ["USD", 5_000n]),
      friend(["COP", -120_000_00n], ["USD", 3_000n]),
    ]);
    expect(approximate).toEqual({
      currency: "COP",
      // 500.000 COP + 80 USD at 4.000 is 820.000 COP; she owes 120.000 COP.
      owedToYou: { total: 820_000_00n, unrated: [] },
      youOwe: { total: 120_000_00n, unrated: [] },
    });
    // Every amount comes out positive, each side on its own.
    expect(calls).toEqual([
      [
        { currency: "COP", amount: 500_000_00n },
        { currency: "USD", amount: 5_000n },
        { currency: "USD", amount: 3_000n },
      ],
      [{ currency: "COP", amount: 120_000_00n }],
    ]);
  });

  it("lists a currency with no rate today apart, on the side it is owed", async () => {
    const totals = createApproximateFriendTotals({ approximate: approximateInPesos() });
    const approximate = await totals("u-ana", [
      friend(["COP", 250_000_00n], ["MXN", 1_000_00n]),
      friend(["ARS", -2_000_00n]),
    ]);
    expect(approximate).toEqual({
      currency: "COP",
      owedToYou: { total: 250_000_00n, unrated: [{ currency: "MXN", amount: 1_000_00n }] },
      youOwe: { total: 0n, unrated: [{ currency: "ARS", amount: 2_000_00n }] },
    });
  });

  it("approximates nothing when every debt is in one currency, whichever it is", async () => {
    const calls: (readonly CurrencyAmount[])[] = [];
    const totals = createApproximateFriendTotals({ approximate: approximateInPesos(calls) });
    expect(await totals("u-ana", [friend(["USD", 5_000n]), friend(["USD", -2_000n]), friend()])).toBeNull();
    expect(await totals("u-ana", [])).toBeNull();
    expect(calls).toEqual([]);
  });

  it("approximates nothing without rates bound", async () => {
    const totals = createApproximateFriendTotals({});
    expect(await totals("u-ana", [friend(["COP", 1n], ["USD", 1n])])).toBeNull();
  });
});
