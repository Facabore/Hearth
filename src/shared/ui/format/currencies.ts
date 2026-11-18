import { minorUnitsOf } from "@/shared/kernel/minor-units";

/**
 * HU-E9-02: amounts on the wire are minor units. Ruling P183: `roundingUnit` is the server's, so the split preview
 * rounds like `Money.allocate`: COP shares are whole pesos. D29: the exponent and rounding unit come from the kernel's
 * `minor-units.ts`, so every ISO 4217 currency is written with its own decimals. Ruling P342: an amount shows its
 * code, never a symbol, so a currency here carries no symbol.
 */
export const currencyOf = (code: string): { exponent: number; roundingUnit: bigint } => minorUnitsOf(code);
