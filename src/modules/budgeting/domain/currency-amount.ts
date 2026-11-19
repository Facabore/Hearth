/**
 * Ruling P342 (S7, owner: "Líneas por moneda"): an amount of a plan in one currency, in its minor units. A plan holds
 * amounts in any number of currencies and never converts between them: every sum, check and figure is per currency.
 */
export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: bigint;
}

/** The amount in `currency`, 0 when the list holds none. */
export const amountIn = (amounts: readonly CurrencyAmount[], currency: string): bigint =>
  amounts.find((a) => a.currency === currency)?.amount ?? 0n;

/** Whether the list holds an amount in `currency`. */
export const holds = (amounts: readonly CurrencyAmount[], currency: string): boolean =>
  amounts.some((a) => a.currency === currency);

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The currencies of a plan in the order its figures list them: `first` (the space's) always first, then the `ordered`
 * ones in their order (a line's budgets as the line lists them), then every other one alphabetically.
 */
export const currencyOrder = (
  first: string | null,
  ordered: readonly string[],
  others: Iterable<string>,
): string[] => {
  const listed: string[] = first === null ? [] : [first];
  for (const currency of ordered) if (!listed.includes(currency)) listed.push(currency);
  const rest = [...new Set(others)].filter((c) => !listed.includes(c)).sort(ordinal);
  return [...listed, ...rest];
};
