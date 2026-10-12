import { describe, expect, it } from "vitest";
import { Money } from "./money";
import { isErr, type Result } from "./result";

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`unexpected error ${r.error.code}`);
  return r.value;
};
const cop = (major: string) => unwrap(Money.fromMajor(major, "COP"));
const majors = (parts: Money[]) => parts.map((p) => p.minor / 100n);

describe("Money", () => {
  it("is stored as bigint minor units", () => {
    const money = cop("1600000");
    expect(money.minor).toBe(160000000n);
    expect(money.currency.code).toBe("COP");
  });

  it("rejects adding different currencies", () => {
    const usd = unwrap(Money.fromMajor("50", "USD"));
    const result = cop("100000").add(usd);
    expect(isErr(result) && result.error.code).toBe("CurrencyMismatch");
  });

  it("allocates by ratio preserving the total", () => {
    expect(majors(unwrap(cop("1470000").allocate([40, 60])))).toEqual([588000n, 882000n]);
  });

  it("allocates remainders in the currency rounding unit, deterministically", () => {
    const first = unwrap(cop("100000").allocate([1, 1, 1]));
    expect(majors(first)).toEqual([33334n, 33333n, 33333n]);
    expect(first.reduce((sum, p) => sum + p.minor, 0n)).toBe(10000000n);
    expect(majors(unwrap(cop("100000").allocate([1, 1, 1])))).toEqual([33334n, 33333n, 33333n]);
  });

  it("gives largest remainders first and breaks ties by input order", () => {
    // 101 pesos by 1:2:2 -> exact 20.2, 40.4, 40.4 -> the leftover peso goes to index 1
    expect(majors(unwrap(cop("101").allocate([1, 2, 2])))).toEqual([20n, 41n, 40n]);
  });

  it("keeps a sub-unit remainder on the first part so the total is exact", () => {
    const parts = unwrap(unwrap(Money.ofMinor(10050n, "COP")).allocate([1, 1]));
    expect(parts.map((p) => p.minor)).toEqual([5050n, 5000n]);
  });

  it("rejects fractional minor units and malformed amounts", () => {
    for (const value of ["10.005", "1e6", "", "12,5", "--1"]) {
      const result = Money.fromMajor(value, "COP");
      expect(isErr(result) && result.error.code).toBe("InvalidMoneyPrecision");
    }
  });

  it("rejects invalid ratios and unknown currencies", () => {
    expect(isErr(cop("10").allocate([]))).toBe(true);
    expect(isErr(cop("10").allocate([0, 0]))).toBe(true);
    expect(isErr(cop("10").allocate([1.5, 1]))).toBe(true);
    expect(isErr(cop("10").allocate([-1, 2]))).toBe(true);
    const unknown = Money.fromMajor("1", "XXX");
    expect(isErr(unknown) && unknown.error.code).toBe("UnknownCurrency");
  });

  it("compares, adds and subtracts", () => {
    expect(unwrap(cop("5").add(cop("7"))).minor).toBe(1200n);
    expect(unwrap(cop("5").subtract(cop("7"))).isNegative()).toBe(true);
    expect(unwrap(cop("5").compare(cop("7")))).toBe(-1);
    expect(unwrap(cop("7").compare(cop("7")))).toBe(0);
    expect(cop("0").isZero()).toBe(true);
    expect(cop("3").equals(cop("3"))).toBe(true);
    expect(unwrap(Money.fromMajor("-12.50", "USD")).minor).toBe(-1250n);
  });
});
