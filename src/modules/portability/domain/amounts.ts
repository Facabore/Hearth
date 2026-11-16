import { currencyOf, domainError, err, flatMap, Money, type Result } from "@/shared/kernel";

/**
 * Money Manager writes decimals as `"12345.0"`, with a trailing fractional zero even for a zero-decimal currency such
 * as COP. `Money.fromMajor` refuses precision beyond the currency's exponent, so we drop trailing fractional zeros
 * first (`"50000.0"` → `"50000"`, `"20.00"` → `"20"`). A non-zero digit past the exponent is a real over-precision and
 * is left for `fromMajor` to reject.
 */
const trimDecimal = (value: string): string => {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
};

/** A decimal string read exactly into minor units (design §2.3). */
export const moneyFromDecimal = (value: string, currency: string): Result<Money> =>
  Money.fromMajor(trimDecimal(value.trim()), currency);

/**
 * numerator rounded to the nearest integer at `exponent` decimals, ties to the even one (the kernel's only money
 * rounding, D29). `value` is a float field (`AMOUNT_ACCOUNT`), already in the account's currency.
 */
const roundHalfEven = (value: number, exponent: number): bigint => {
  const negative = value < 0;
  const scaled = Math.abs(value) * 10 ** exponent;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  let rounded = floor;
  if (fraction > 0.5) rounded = floor + 1;
  else if (fraction === 0.5) rounded = floor % 2 === 0 ? floor : floor + 1;
  return BigInt(negative ? -rounded : rounded);
};

/**
 * A float field (`AMOUNT_ACCOUNT`) converted to minor units with the kernel's half-even rounding only (design §2.3,
 * D29). An infinite or NaN value is `InvalidMoneyPrecision`.
 */
export const moneyFromFloat = (value: number, currency: string): Result<Money> =>
  flatMap(currencyOf(currency), (c) =>
    Number.isFinite(value)
      ? Money.ofMinor(roundHalfEven(value, c.exponent), currency)
      : err(domainError("InvalidMoneyPrecision", { value: String(value) })),
  );
