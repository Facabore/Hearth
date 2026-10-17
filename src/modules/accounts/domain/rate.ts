import { domainError, err, ok, type Result } from "@/shared/kernel";

/** HU-E2-06, ruling P52: rates are integer parts per million of the base (2.0 % = 20,000), from 0 to 100 %. */
export const MAX_RATE_PPM = 1_000_000;

const PERCENT = /^(\d{1,3})(?:\.(\d{1,4}))?$/;

/** "2.0", "28.59" → parts per million; anything else, or above 100 %, is InvalidRate. */
export const ratePpmOf = (percent: string): Result<number> => {
  const match = PERCENT.exec(percent);
  const ppm = match ? Number(match[1]) * 10_000 + Number((match[2] ?? "").padEnd(4, "0")) : Number.NaN;
  return Number.isInteger(ppm) && ppm <= MAX_RATE_PPM
    ? ok(ppm)
    : err(domainError("InvalidRate", { value: percent }));
};

/**
 * 268,242 → "26.8242": a percent with exactly four decimals (spec 7 as amended), cut in `bigint`, never in floats.
 * Precondition: `ppm` is a whole number of at least 0; anything else is a programming error and throws a RangeError.
 */
export const percentText = (ppm: number): string => {
  if (ppm < 0) throw new RangeError(`A rate is not negative: ${ppm}`);
  const parts = BigInt(ppm);
  return `${parts / 10_000n}.${String(parts % 10_000n).padStart(4, "0")}`;
};

const MILLION = 1_000_000n;
const roundedDiv = (n: bigint, d: bigint): bigint => (n + d / 2n) / d;

/** HU-E2-06: EA = (1 + i_m)^12 − 1, to the nearest part per million. */
export const effectiveAnnualPpm = (monthlyPpm: number): number =>
  Number(roundedDiv((MILLION + BigInt(monthlyPpm)) ** 12n, MILLION ** 11n) - MILLION);

const SCALE = 10n ** 18n;

/** 1 + EA = 2^12 is a monthly rate of 100 %: the root reaches the top of the bisection interval [SCALE, 2 * SCALE). */
const ANNUAL_PPM_CEILING = 4_095_000_000;

/**
 * HU-E2-06: i_m = (1 + EA)^(1/12) − 1, to the nearest part per million (a 12th root by bisection, no floats).
 * Precondition: `annualPpm` is a whole number from 0 to 4,094,999,999; anything else is a programming error and
 * throws a RangeError. Rates a user can store stop at 1,000,000.
 */
export const equivalentMonthlyPpm = (annualPpm: number): number => {
  if (annualPpm < 0 || annualPpm >= ANNUAL_PPM_CEILING) {
    throw new RangeError(`An annual rate of ${annualPpm} ppm is outside 0 to ${ANNUAL_PPM_CEILING - 1}`);
  }
  const target = ((MILLION + BigInt(annualPpm)) * SCALE ** 12n) / MILLION;
  let low = SCALE;
  let high = 2n * SCALE;
  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    if (mid ** 12n <= target) low = mid;
    else high = mid;
  }
  return Number(roundedDiv((low - SCALE) * MILLION, SCALE));
};
