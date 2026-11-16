import { currencyOf, type Currency } from "./currency";
import { domainError } from "./domain-error";
import type { ExchangeRate } from "./exchange-rate";
import { err, flatMap, map, ok, type Result } from "./result";

const MAJOR = /^(-?)(\d+)(?:\.(\d+))?$/;

/** numerator / denominator (denominator > 0) to the nearest integer, ties to the even one, symmetric around zero. */
const roundHalfEven = (numerator: bigint, denominator: bigint): bigint => {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const twice = (magnitude % denominator) * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) quotient += 1n;
  return negative ? -quotient : quotient;
};

export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: Currency,
  ) {}

  static ofMinor(minor: bigint, currency: string): Result<Money> {
    return map(currencyOf(currency), (c) => new Money(minor, c));
  }

  /** Parses a decimal string such as "1600000" or "12.50"; never accepts floats. */
  static fromMajor(major: string, currency: string): Result<Money> {
    return flatMap(currencyOf(currency), (c) => {
      const match = major.match(MAJOR);
      if (!match) return err(domainError("InvalidMoneyPrecision", { value: major }));
      const [, sign, whole, fraction = ""] = match;
      if (fraction.length > c.exponent) return err(domainError("InvalidMoneyPrecision", { value: major }));
      const minor = BigInt(`${whole}${fraction.padEnd(c.exponent, "0")}`);
      return ok(new Money(sign === "-" ? -minor : minor, c));
    });
  }

  add(other: Money): Result<Money> {
    return this.sameCurrency(other)
      ? ok(new Money(this.minor + other.minor, this.currency))
      : this.mismatch(other);
  }

  subtract(other: Money): Result<Money> {
    return this.sameCurrency(other)
      ? ok(new Money(this.minor - other.minor, this.currency))
      : this.mismatch(other);
  }

  compare(other: Money): Result<-1 | 0 | 1> {
    if (!this.sameCurrency(other)) return this.mismatch(other);
    return ok(this.minor === other.minor ? 0 : this.minor < other.minor ? -1 : 1);
  }

  equals(other: Money): boolean {
    return this.sameCurrency(other) && this.minor === other.minor;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  /**
   * Largest-remainder allocation in the currency rounding unit (spec 5.3).
   * Ties go to the earlier ratio. A sub-unit remainder (amount not a multiple
   * of the rounding unit) is added to the first part. Negative amounts are split by
   * allocating their absolute value and negating every part, so the total stays exact. Ratios are
   * non-negative integers, as numbers or bigints (HU-E6-05 weighs by capacities in minor units).
   */
  allocate(ratios: readonly (number | bigint)[]): Result<Money[]> {
    const valid = (r: number | bigint) => (typeof r === "bigint" ? r >= 0n : Number.isInteger(r) && r >= 0);
    // Details stay strings: a bigint never reaches a log serializer.
    const invalid = () => err(domainError("InvalidRatio", { ratios: ratios.map(String) }));
    if (ratios.length === 0 || !ratios.every(valid)) return invalid();
    const weights = ratios.map((r) => BigInt(r));
    const totalWeight = weights.reduce((a, b) => a + b, 0n);
    if (totalWeight === 0n) return invalid();
    if (this.minor < 0n) {
      return map(new Money(-this.minor, this.currency).allocate(ratios), (parts) =>
        parts.map((part) => new Money(-part.minor, this.currency)),
      );
    }

    const unit = this.currency.roundingUnit;
    const units = this.minor / unit;
    const subUnit = this.minor % unit;

    const shares = weights.map((w, index) => ({
      index,
      base: (units * w) / totalWeight,
      rem: (units * w) % totalWeight,
    }));
    let leftover = units - shares.reduce((sum, s) => sum + s.base, 0n);
    const order = [...shares].sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
    for (const share of order) {
      if (leftover <= 0n) break;
      share.base += 1n;
      leftover -= 1n;
    }
    return ok(shares.map((s) => new Money(s.base * unit + (s.index === 0 ? subUnit : 0n), this.currency)));
  }

  /**
   * D30: this amount in the rate's quote currency, rounded half to even at that currency's minor unit, the only
   * rounding a conversion gets. The rate's base must be this amount's currency (`CurrencyMismatch`).
   */
  convert(rate: ExchangeRate): Result<Money> {
    if (rate.base !== this.currency.code) {
      return err(domainError("CurrencyMismatch", { left: this.currency.code, right: rate.base }));
    }
    return map(currencyOf(rate.quote), (target) => {
      // target minor = minor × units / 10^scale × 10^(target exponent − source exponent)
      const shift = target.exponent - this.currency.exponent - rate.scale;
      const numerator = this.minor * rate.units * (shift > 0 ? 10n ** BigInt(shift) : 1n);
      const denominator = shift < 0 ? 10n ** BigInt(-shift) : 1n;
      return new Money(roundHalfEven(numerator, denominator), target);
    });
  }

  private sameCurrency(other: Money): boolean {
    return this.currency.code === other.currency.code;
  }

  private mismatch<T>(other: Money): Result<T> {
    return err(domainError("CurrencyMismatch", { left: this.currency.code, right: other.currency.code }));
  }
}
