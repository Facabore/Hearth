import { describe, expect, it } from "vitest";
import { ExchangeRate } from "./exchange-rate";
import { Money } from "./money";
import type { Result } from "./result";

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`unexpected error ${r.error.code}`);
  return r.value;
};
const errorOf = <T>(r: Result<T>) => (r.ok ? null : r.error.code);
const rate = (base: string, quote: string, value: string) => unwrap(ExchangeRate.of(base, quote, value));
const money = (major: string, code: string) => unwrap(Money.fromMajor(major, code));
const convert = (major: string, code: string, r: ExchangeRate) => {
  const converted = unwrap(money(major, code).convert(r));
  return [converted.minor, converted.currency.code];
};

describe("ExchangeRate (D30)", () => {
  it("is an exact positive decimal between two known currencies", () => {
    const usdCop = rate("USD", "COP", "4100.25");
    expect([usdCop.base, usdCop.quote, usdCop.value]).toEqual(["USD", "COP", "4100.25"]);
  });

  it("writes its value without trailing zeros", () => {
    expect(rate("USD", "COP", "4100.2500").value).toBe("4100.25");
    expect(rate("USD", "COP", "4100.0").value).toBe("4100");
    expect(rate("COP", "USD", "0.000243900").value).toBe("0.0002439");
  });

  it("refuses a rate that is not a positive plain decimal", () => {
    for (const value of ["0", "0.000", "-4100", "4e3", "4,100", "", " 4100", "1.", ".5", "NaN"]) {
      expect(errorOf(ExchangeRate.of("USD", "COP", value))).toBe("InvalidExchangeRate");
    }
  });

  it("refuses a rate between a currency and itself or an unknown one", () => {
    expect(errorOf(ExchangeRate.of("USD", "USD", "1"))).toBe("InvalidExchangeRate");
    expect(errorOf(ExchangeRate.of("USD", "XYZ", "2"))).toBe("UnknownCurrency");
  });
});

describe("Money.convert (D30)", () => {
  it("converts into the rate's quote currency, exactly", () => {
    expect(convert("50", "USD", rate("USD", "COP", "4100"))).toEqual([20500000n, "COP"]);
    expect(convert("12.34", "USD", rate("USD", "COP", "4100.5"))).toEqual([5060017n, "COP"]);
  });

  it("follows each currency's exponent", () => {
    expect(convert("1000", "JPY", rate("JPY", "COP", "27.5"))).toEqual([2750000n, "COP"]);
    expect(convert("1.5", "KWD", rate("KWD", "USD", "3.25"))).toEqual([488n, "USD"]);
    expect(convert("10", "USD", rate("USD", "JPY", "151.37"))).toEqual([1514n, "JPY"]);
  });

  it("rounds half to even at the target's minor unit", () => {
    // 1 JPY at 0.005 USD is half a cent: even is 0; at 0.015 it is 1.5 cents: even is 2.
    expect(convert("1", "JPY", rate("JPY", "USD", "0.005"))).toEqual([0n, "USD"]);
    expect(convert("1", "JPY", rate("JPY", "USD", "0.015"))).toEqual([2n, "USD"]);
    expect(convert("1", "JPY", rate("JPY", "USD", "0.0151"))).toEqual([2n, "USD"]);
    expect(convert("1", "JPY", rate("JPY", "USD", "0.0149"))).toEqual([1n, "USD"]);
  });

  it("keeps the sign of a negative amount, rounding it the same way", () => {
    expect(convert("-50", "USD", rate("USD", "COP", "4100"))).toEqual([-20500000n, "COP"]);
    expect(convert("-1", "JPY", rate("JPY", "USD", "0.015"))).toEqual([-2n, "USD"]);
  });

  it("refuses a rate whose base is not the money's currency", () => {
    expect(errorOf(money("50", "EUR").convert(rate("USD", "COP", "4100")))).toBe("CurrencyMismatch");
  });
});
