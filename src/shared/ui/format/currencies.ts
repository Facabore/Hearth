/**
 * HU-E9-02: the symbol a currency shows, never the language's (P68); amounts on the wire are minor units. Ruling
 * P183: `roundingUnit` is the server's (`src/shared/kernel/currency.ts`), so the split preview rounds like
 * `Money.allocate`: COP shares are whole pesos.
 */
const CURRENCIES: Readonly<
  Record<string, { readonly symbol: string; readonly exponent: number; readonly roundingUnit: bigint }>
> = {
  COP: { symbol: "$", exponent: 2, roundingUnit: 100n },
  USD: { symbol: "US$", exponent: 2, roundingUnit: 1n },
  EUR: { symbol: "€", exponent: 2, roundingUnit: 1n },
};

/** A known currency's symbol, exponent and rounding unit; an unknown code shows itself, exponent 2, unit 1. */
export const currencyOf = (code: string): { symbol: string; exponent: number; roundingUnit: bigint } =>
  CURRENCIES[code] ?? { symbol: code, exponent: 2, roundingUnit: 1n };
