import { domainError, ExchangeRate, err, ok, type Result } from "@/shared/kernel";

/**
 * D30: fixed number of fractional digits a derived (inverted or composed) rate keeps. A reciprocal is generally
 * non-terminating, so a cross rate is rounded half to even to this scale; the final money rounding still happens in
 * `Money.convert`, so this bounds the stored rate's precision without affecting a direct, exact source rate.
 */
export const CROSS_RATE_SCALE = 12;

const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);

/** numerator / denominator (denominator > 0) to the nearest integer, ties to even, symmetric around zero. */
const roundHalfEven = (numerator: bigint, denominator: bigint): bigint => {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const twice = (magnitude % denominator) * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) quotient += 1n;
  return negative ? -quotient : quotient;
};

/** A non-negative scaled integer (`units` / 10^`scale`) as a plain decimal string; `ExchangeRate.of` trims zeros. */
const render = (units: bigint, scale: number): string => {
  if (scale <= 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${whole}.${fraction}`;
};

/** Builds a rate from a scaled integer, rounding half to even down to CROSS_RATE_SCALE when it has more digits. */
const fromScaled = (base: string, quote: string, units: bigint, scale: number): Result<ExchangeRate> => {
  if (scale <= CROSS_RATE_SCALE) return ExchangeRate.of(base, quote, render(units, scale));
  const rounded = roundHalfEven(units, pow10(scale - CROSS_RATE_SCALE));
  return ExchangeRate.of(base, quote, render(rounded, CROSS_RATE_SCALE));
};

/** D30: the reverse rate (quote->base), 1 / value, rounded half to even to CROSS_RATE_SCALE fractional digits. */
export const invert = (rate: ExchangeRate): Result<ExchangeRate> => {
  // value = units / 10^scale, so 1/value = 10^scale / units. Scaled to CROSS_RATE_SCALE: 10^(scale+SCALE) / units.
  const rounded = roundHalfEven(pow10(rate.scale + CROSS_RATE_SCALE), rate.units);
  return ExchangeRate.of(rate.quote, rate.base, render(rounded, CROSS_RATE_SCALE));
};

/** D30: chains a.base->a.quote with b.base->b.quote into a.base->b.quote; requires a.quote === b.base. */
export const compose = (a: ExchangeRate, b: ExchangeRate): Result<ExchangeRate> => {
  if (a.quote !== b.base) return err(domainError("CurrencyMismatch", { left: a.quote, right: b.base }));
  return fromScaled(a.base, b.quote, a.units * b.units, a.scale + b.scale);
};

const before = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * D30: `base`->`quote` over `edges`, each usable forward and inverted, by the fewest hops through a shared pivot
 * currency. A direct edge wins over any pivot; among equal-length paths the result is deterministic. `base === quote`
 * is invalid (as `ExchangeRate.of`); unconnected currencies give `NoExchangeRate`.
 */
export const crossRate = (
  edges: readonly ExchangeRate[],
  base: string,
  quote: string,
): Result<ExchangeRate> => {
  const path = crossRatePath(edges, base, quote);
  return path.ok ? ok(path.value.rate) : path;
};

/** D30, D29 (MC4): a resolved rate and the oriented edges it was composed from, in order. */
export interface RatePath {
  readonly rate: ExchangeRate;
  /** Each hop as taken (a stored edge or its inverse) with the edge, as given, it came from; a direct pair has one. */
  readonly legs: readonly { readonly rate: ExchangeRate; readonly source: ExchangeRate }[];
}

/**
 * D29 (MC4): `crossRate`'s resolution, with the legs it went through, so a caller can tell which stored rates, and so
 * which days, the answer rests on.
 */
export const crossRatePath = (
  edges: readonly ExchangeRate[],
  base: string,
  quote: string,
): Result<RatePath> => {
  if (base === quote) return err(domainError("InvalidExchangeRate", { base, quote }));

  // Adjacency from each currency, forward edges first so a stored direct pair wins its inverse; first orientation kept.
  type Leg = RatePath["legs"][number];
  const adjacency = new Map<string, Map<string, Leg>>();
  const connect = (leg: Leg): void => {
    const neighbours = adjacency.get(leg.rate.base) ?? new Map<string, Leg>();
    if (!neighbours.has(leg.rate.quote)) neighbours.set(leg.rate.quote, leg);
    adjacency.set(leg.rate.base, neighbours);
  };
  const sorted = [...edges].sort((a, b) => before(a.base, b.base) || before(a.quote, b.quote));
  for (const edge of sorted) connect({ rate: edge, source: edge });
  for (const edge of sorted) {
    const reversed = invert(edge);
    if (reversed.ok) connect({ rate: reversed.value, source: edge });
  }

  // Breadth-first shortest-hop search; records the oriented rate taken to reach each currency.
  const cameBy = new Map<string, { from: string; leg: Leg }>();
  const visited = new Set<string>([base]);
  let frontier = [base];
  while (frontier.length > 0 && !visited.has(quote)) {
    const next: string[] = [];
    for (const node of frontier) {
      const neighbours = adjacency.get(node);
      if (!neighbours) continue;
      for (const to of [...neighbours.keys()].sort(before)) {
        if (visited.has(to)) continue;
        visited.add(to);
        cameBy.set(to, { from: node, leg: neighbours.get(to)! });
        next.push(to);
      }
    }
    frontier = next;
  }

  if (!cameBy.has(quote)) return err(domainError("NoExchangeRate", { base, quote }));

  // Walk the path back to `base`, then compose the oriented rates in order.
  const chain: Leg[] = [];
  let cursor = quote;
  while (cursor !== base) {
    const step = cameBy.get(cursor)!;
    chain.unshift(step.leg);
    cursor = step.from;
  }
  let accumulated = chain[0]!.rate;
  for (let i = 1; i < chain.length; i += 1) {
    const composed = compose(accumulated, chain[i]!.rate);
    if (!composed.ok) return composed;
    accumulated = composed.value;
  }
  return ok({ rate: accumulated, legs: chain });
};
