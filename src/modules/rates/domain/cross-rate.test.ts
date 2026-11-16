import { describe, expect, it } from "vitest";
import { ExchangeRate } from "@/shared/kernel";
import { compose, CROSS_RATE_SCALE, crossRate, invert } from "./cross-rate";

/** Unwraps a Result in a test, failing loudly otherwise. */
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!r.ok) throw new Error(`expected ok, got error ${r.error.code}`);
  return r.value;
};

const rate = (base: string, quote: string, value: string): ExchangeRate =>
  unwrap(ExchangeRate.of(base, quote, value));

// Real reference rates (ECB 2026-11-13, TRM): base currency first.
const eurUsd = rate("EUR", "USD", "1.1052");
const eurMxn = rate("EUR", "MXN", "20.5491");
const usdCop = rate("USD", "COP", "3316.7");

describe("invert", () => {
  it("returns the reciprocal, oriented quote->base, within the fixed scale", () => {
    const inv = unwrap(invert(eurUsd));
    expect(inv.base).toBe("USD");
    expect(inv.quote).toBe("EUR");
    expect(Number(inv.value)).toBeCloseTo(1 / 1.1052, 10);
    // At most CROSS_RATE_SCALE fractional digits.
    const fraction = inv.value.split(".")[1] ?? "";
    expect(fraction.length).toBeLessThanOrEqual(CROSS_RATE_SCALE);
  });
});

describe("compose", () => {
  it("multiplies two exact decimals exactly when they fit the scale", () => {
    // EUR->USD then USD->COP = EUR->COP, exact: 1.1052 * 3316.7 = 3665.61684
    const eurCop = unwrap(compose(eurUsd, usdCop));
    expect(eurCop.base).toBe("EUR");
    expect(eurCop.quote).toBe("COP");
    expect(eurCop.value).toBe("3665.61684");
  });

  it("rejects a chain whose middle currencies do not meet", () => {
    const r = compose(eurUsd, eurMxn); // USD !== EUR
    expect(r.ok).toBe(false);
  });
});

describe("crossRate", () => {
  it("prefers a direct edge", () => {
    expect(unwrap(crossRate([usdCop], "USD", "COP")).value).toBe("3316.7");
  });

  it("inverts a single edge when only the reverse is stored", () => {
    expect(Number(unwrap(crossRate([usdCop], "COP", "USD")).value)).toBeCloseTo(1 / 3316.7, 10);
  });

  it("pivots two edges through a shared currency (USD->MXN via EUR)", () => {
    const r = unwrap(crossRate([eurUsd, eurMxn], "USD", "MXN"));
    expect(r.base).toBe("USD");
    expect(r.quote).toBe("MXN");
    expect(Number(r.value)).toBeCloseTo(20.5491 / 1.1052, 8);
  });

  it("resolves COP->MXN across three hops (TRM + ECB)", () => {
    const r = unwrap(crossRate([eurUsd, eurMxn, usdCop], "COP", "MXN"));
    // COP->MXN = (USD->MXN) / (USD->COP) = (20.5491/1.1052) / 3316.7
    expect(Number(r.value)).toBeCloseTo(20.5491 / 1.1052 / 3316.7, 10);
  });

  it("rejects the same currency on both sides", () => {
    const r = crossRate([usdCop], "USD", "USD");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("InvalidExchangeRate");
  });

  it("reports no path when the currencies are not connected", () => {
    const r = crossRate([eurUsd], "JPY", "GBP");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NoExchangeRate");
  });

  it("is deterministic", () => {
    const a = unwrap(crossRate([eurUsd, eurMxn, usdCop], "COP", "MXN")).value;
    const b = unwrap(crossRate([usdCop, eurMxn, eurUsd], "COP", "MXN")).value;
    expect(a).toBe(b);
  });
});
