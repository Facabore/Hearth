import { domainError, err, Money, type Result } from "@/shared/kernel";

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

const EXPONENT_FORM = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/;

/**
 * The shortest decimal that reads back as this float (`String(value)`), with exponent notation (`1e-7`, `1.5e+21`)
 * written out digit for digit. Moving the decimal point is exact; nothing is rounded here.
 */
const plainDecimal = (value: number): string => {
  const text = String(value);
  const match = text.match(EXPONENT_FORM);
  if (!match) return text;
  const [, sign, lead, rest = "", exponent] = match;
  const digits = `${lead}${rest}`;
  const point = 1 + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
};

/**
 * A float field (`AMOUNT_ACCOUNT`) in minor units (design §2.3, D29): its shortest decimal form, rounded half to even
 * by the kernel (`Money.fromDecimalRounded`), so 1.015 is 1.02 and never the double's 1.01499…. An infinite or NaN
 * value is `InvalidMoneyPrecision`.
 */
export const moneyFromFloat = (value: number, currency: string): Result<Money> =>
  Number.isFinite(value)
    ? Money.fromDecimalRounded(plainDecimal(value), currency)
    : err(domainError("InvalidMoneyPrecision", { value: String(value) }));
