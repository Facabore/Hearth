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

/** Ruling P342 (S6): an amount in one currency, in its minor units. */
export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: bigint;
}

/** Ruling P342 (S6): one currency of an approximate total, with its value in the total's currency (null: no rate). */
export interface ApproximatePart extends CurrencyAmount {
  readonly value: bigint | null;
}

/**
 * Ruling P342 (S6): a total across currencies, for display only and never stored. `parts` are the sums per currency,
 * never converted: `currency`'s own first, then the largest in `currency` first, then those without a rate by code.
 * `total` adds the parts that have a rate; a part without one is left out and listed apart, never counted at 1:1.
 */
export interface ApproximateTotal {
  readonly currency: string;
  readonly total: bigint;
  readonly parts: readonly ApproximatePart[];
}

/** Ruling P342 (S6): the non-zero sums of `amounts` per currency, in the order they first appear. */
export const sumsByCurrency = (amounts: readonly CurrencyAmount[]): CurrencyAmount[] => {
  const sums = new Map<string, bigint>();
  for (const { currency, amount } of amounts) sums.set(currency, (sums.get(currency) ?? 0n) + amount);
  return [...sums].filter(([, amount]) => amount !== 0n).map(([currency, amount]) => ({ currency, amount }));
};

const partOrder = (into: string) => (a: ApproximatePart, b: ApproximatePart) => {
  if ((a.currency === into) !== (b.currency === into)) return a.currency === into ? -1 : 1;
  if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
  if (a.value !== null && b.value !== null && a.value !== b.value) return a.value > b.value ? -1 : 1;
  return a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;
};

/**
 * Ruling P342 (S6, owner: "no hay intercambio del mismo (a menos que sea explícito)"): `amounts` added into `into` at
 * the rate of `on` (D30's stored daily rates), through `Money.convert` only, for display. A currency whose latest rate
 * by `on` is more than a week old, or that has none, has no rate today: it is not added, and its part says so.
 */
export const approximateTotalOn = async (
  rates: ReportRates | undefined,
  amounts: readonly CurrencyAmount[],
  into: string,
  on: LocalDate,
): Promise<ApproximateTotal> => {
  const parts = await Promise.all(
    sumsByCurrency(amounts).map(async ({ currency, amount }): Promise<ApproximatePart> => {
      if (currency === into) return { currency, amount, value: amount };
      const rate = rates === undefined ? null : await rates.datedRateOn(currency, into, on);
      if (rate === null || !rate.ok || rate.value.stale) return { currency, amount, value: null };
      const value = convertWith(amount, currency, rate.value.rate);
      return { currency, amount, value: value.ok ? value.value : null };
    }),
  );
  return {
    currency: into,
    total: parts.reduce((sum, part) => sum + (part.value ?? 0n), 0n),
    parts: parts.sort(partOrder(into)),
  };
};

/** Ruling P342 (S6): what a person's approximate totals read: their currency and their today, bound in composition. */
export interface ApproximateTodayDeps {
  readonly rates: ReportRates;
  /** The person's display currency, else their personal space's (D29); null without a personal space. */
  readonly currencyOf: (userId: string) => Promise<string | null>;
  /** The person's today, from the app's clock in their time zone. */
  readonly todayOf: (userId: string) => Promise<LocalDate>;
}

/**
 * Ruling P342 (S6): `amounts` approximately in the person's currency at today's rate, for display only; null for a
 * person without a currency to add up in.
 */
export type ApproximateToday = (
  userId: string,
  amounts: readonly CurrencyAmount[],
) => Promise<ApproximateTotal | null>;

export const createApproximateToday =
  (deps: ApproximateTodayDeps): ApproximateToday =>
  async (userId, amounts) => {
    const [into, on] = await Promise.all([deps.currencyOf(userId), deps.todayOf(userId)]);
    return into === null ? null : approximateTotalOn(deps.rates, amounts, into, on);
  };
