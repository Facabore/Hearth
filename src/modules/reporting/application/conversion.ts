import {
  addDays,
  flatMap,
  map,
  Money,
  type ExchangeRate,
  type LocalDate,
  type Result,
} from "@/shared/kernel";

/**
 * D29, slice MC4: the narrow port the personal reports convert with, bound in composition to the rates module's dated
 * read: `base`->`quote` from the latest stored rate on or before `on`, with that rate's day and whether it is more than
 * a week older than `on` (`NoExchangeRate` when none connects them by then).
 */
export interface ReportRates {
  datedRateOn(
    base: string,
    quote: string,
    on: LocalDate,
  ): Promise<Result<{ readonly rate: ExchangeRate; readonly date: LocalDate; readonly stale: boolean }>>;
}

/** D29, slice MC4: the person's display currency; null follows their personal space's (identity, bound in composition). */
export type DisplayCurrencyOf = (userId: string) => Promise<string | null>;

/** Every day from `from` through `to`, both included. */
export const daysOf = (from: LocalDate, to: LocalDate): LocalDate[] => {
  const days: LocalDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
};

/**
 * D29, slice MC4: converts amounts into `to` at the rate of each day, through `Money.convert` only, reading each
 * (currency, day) rate once. It remembers whether anything was converted and whether any rate used was stale; an
 * amount with no rate for its day answers null, and the caller lists it apart (never at 1:1).
 */
export const converterInto = (rates: ReportRates | undefined, to: string) => {
  const read = new Map<string, ReturnType<ReportRates["datedRateOn"]>>();
  let converted = false;
  let stale = false;
  /** The rate from `from` into `to` on `day`, or null; the same currency needs none. */
  const rateOn = async (from: string, day: LocalDate): Promise<ExchangeRate | null> => {
    if (rates === undefined) return null;
    const key = `${from}>${day}`;
    if (!read.has(key)) read.set(key, rates.datedRateOn(from, to, day));
    const rate = await read.get(key)!;
    if (!rate.ok) return null;
    converted = true;
    stale ||= rate.value.stale;
    return rate.value.rate;
  };
  return {
    rateOn,
    /** `minor` of `from` on `day`, in `to`; null without a rate. */
    convert: async (minor: bigint, from: string, day: LocalDate): Promise<bigint | null> => {
      if (from === to) return minor;
      const rate = await rateOn(from, day);
      if (rate === null) return null;
      const value = convertWith(minor, from, rate);
      return value.ok ? value.value : null;
    },
    get converted() {
      return converted;
    },
    get stale() {
      return stale;
    },
  };
};

/** `minor` of `from` at `rate`, as `Money.convert` rounds it. */
export const convertWith = (minor: bigint, from: string, rate: ExchangeRate): Result<bigint> =>
  map(
    flatMap(Money.ofMinor(minor, from), (money) => money.convert(rate)),
    (money) => money.minor,
  );
