import { currencyOf } from "@/shared/ui/format/currencies";

const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** numerator / denominator (denominator > 0, numerator ≥ 0) to the nearest integer, ties to the even one. */
const roundHalfEven = (numerator: bigint, denominator: bigint): bigint => {
  let quotient = numerator / denominator;
  const twice = (numerator % denominator) * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) quotient += 1n;
  return quotient;
};

/**
 * P342 (board 4): the account leg Registrar suggests, `minor` units of `from` at `rate` (units of `to` per unit of
 * `from`, the API's exact decimal), in `to`'s minor units. It is the kernel's `Money.convert` (D30), rounded half to
 * even at `to`'s minor unit, the conversion the API itself applies when no leg is sent; the kernel stays out of the UI
 * (ruling P119), so the arithmetic is mirrored here. Null for a rate that is not a plain positive decimal.
 */
export const suggestedLeg = (minor: string, from: string, to: string, rate: string): string | null => {
  const match = PLAIN_DECIMAL.exec(rate);
  if (!match || !/^\d+$/.test(minor)) return null;
  const [, whole, fraction = ""] = match;
  const units = BigInt(`${whole}${fraction}`);
  if (units === 0n) return null;
  const shift = currencyOf(to).exponent - currencyOf(from).exponent - fraction.length;
  const numerator = BigInt(minor) * units * (shift > 0 ? 10n ** BigInt(shift) : 1n);
  const denominator = shift < 0 ? 10n ** BigInt(-shift) : 1n;
  return roundHalfEven(numerator, denominator).toString();
};
