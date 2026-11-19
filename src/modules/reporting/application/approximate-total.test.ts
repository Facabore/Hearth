import { describe, expect, it } from "vitest";
import { domainError, err, ExchangeRate, ok, type LocalDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { approximateTotalOn, createApproximateToday } from "./conversion";

const TODAY = "2026-11-18" as LocalDate;

/** Rates as the rates module dates them: `base>quote` → decimal, read on `on`; any other pair has none. */
const ratesOf = (table: Record<string, string>, stale: readonly string[] = []) => {
  const asked: string[] = [];
  return {
    asked,
    datedRateOn: async (base: string, quote: string, on: LocalDate) => {
      asked.push(`${base}>${quote}@${on}`);
      const value = table[`${base}>${quote}`];
      return value === undefined
        ? err(domainError("NoExchangeRate", { base, quote }))
        : ok({
            rate: unwrap(ExchangeRate.of(base, quote, value)),
            date: on,
            stale: stale.includes(base),
          });
    },
  };
};

describe("approximate total across currencies (P342, S6)", () => {
  it("adds 80 USD and 25 EUR to 1.240.000 COP at today's rate, the largest first after COP", async () => {
    const rates = ratesOf({ "USD>COP": "4000", "EUR>COP": "4000" });
    const total = await approximateTotalOn(
      rates,
      [
        { currency: "EUR", amount: 2_500n },
        { currency: "COP", amount: 1_240_000_00n },
        { currency: "USD", amount: 8_000n },
      ],
      "COP",
      TODAY,
    );
    expect(total).toEqual({
      currency: "COP",
      total: 1_660_000_00n,
      parts: [
        { currency: "COP", amount: 1_240_000_00n, value: 1_240_000_00n },
        { currency: "USD", amount: 8_000n, value: 320_000_00n },
        { currency: "EUR", amount: 2_500n, value: 100_000_00n },
      ],
    });
    // Each currency's rate is read once, on today's date.
    expect(rates.asked.sort()).toEqual(["EUR>COP@2026-11-18", "USD>COP@2026-11-18"]);
  });

  it("leaves a currency without a rate out of the total and lists it last, never at 1:1", async () => {
    const total = await approximateTotalOn(
      ratesOf({ "USD>COP": "4000" }),
      [
        { currency: "ARS", amount: 1_000_00n },
        { currency: "COP", amount: 100_000_00n },
        { currency: "USD", amount: 1_000n },
      ],
      "COP",
      TODAY,
    );
    expect(total.total).toBe(140_000_00n);
    expect(total.parts.at(-1)).toEqual({ currency: "ARS", amount: 1_000_00n, value: null });
  });

  it("treats a rate more than a week old as no rate today", async () => {
    const total = await approximateTotalOn(
      ratesOf({ "USD>COP": "4000" }, ["USD"]),
      [
        { currency: "COP", amount: 100n },
        { currency: "USD", amount: 1_000n },
      ],
      "COP",
      TODAY,
    );
    expect(total).toMatchObject({
      total: 100n,
      parts: [{ currency: "COP" }, { currency: "USD", value: null }],
    });
  });

  it("sums each currency first and drops one that adds up to zero", async () => {
    const total = await approximateTotalOn(
      undefined,
      [
        { currency: "COP", amount: 300n },
        { currency: "USD", amount: 500n },
        { currency: "COP", amount: 200n },
        { currency: "USD", amount: -500n },
      ],
      "COP",
      TODAY,
    );
    expect(total).toEqual({
      currency: "COP",
      total: 500n,
      parts: [{ currency: "COP", amount: 500n, value: 500n }],
    });
  });

  it("converts into the person's currency on the person's today, from the ports composition binds", async () => {
    const rates = ratesOf({ "COP>USD": "0.00025" });
    const approximate = createApproximateToday({
      rates,
      currencyOf: async () => "USD",
      todayOf: async () => TODAY,
    });
    const total = await approximate("u-ana", [
      { currency: "COP", amount: 400_000_00n },
      { currency: "USD", amount: 1_250n },
    ]);
    expect([total?.currency, total?.total]).toEqual(["USD", 10_000n + 1_250n]);
    expect(rates.asked).toEqual(["COP>USD@2026-11-18"]);
  });

  it("approximates nothing for a person without a currency to add up in", async () => {
    const approximate = createApproximateToday({
      rates: ratesOf({}),
      currencyOf: async () => null,
      todayOf: async () => TODAY,
    });
    expect(await approximate("u-nobody", [{ currency: "COP", amount: 1n }])).toBeNull();
  });
});
