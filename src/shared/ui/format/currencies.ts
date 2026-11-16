import { minorUnitsOf } from "@/shared/kernel/minor-units";

/**
 * HU-E9-02: the symbol a currency shows, never the language's (P68); amounts on the wire are minor units. Ruling
 * P183: `roundingUnit` is the server's, so the split preview rounds like `Money.allocate`: COP shares are whole pesos.
 * D29: the exponent and rounding unit come from the kernel's `minor-units.ts`, so every ISO 4217 currency is written
 * with its own decimals; a currency without a symbol here shows its code.
 */
const SYMBOLS: ReadonlyMap<string, string> = new Map([
  ["COP", "$"],
  ["USD", "US$"],
  ["EUR", "€"],
]);

/** A currency's symbol, exponent and rounding unit; a code without a symbol shows itself. */
export const currencyOf = (code: string): { symbol: string; exponent: number; roundingUnit: bigint } => ({
  symbol: SYMBOLS.get(code) ?? code,
  ...minorUnitsOf(code),
});
