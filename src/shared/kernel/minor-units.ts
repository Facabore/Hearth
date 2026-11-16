/**
 * D29: how a currency's amounts are written and split, with no other dependency, so the SPA's formatters can read it
 * without the kernel's list of currencies (`currency.ts` decides which codes exist). Most ISO 4217 currencies have
 * two decimals; these are the exceptions. Two patterns rather than a table keep it small in every screen's script.
 */
const NO_DECIMALS = /^(BIF|CLP|DJF|GNF|ISK|JPY|KMF|KRW|PYG|RWF|UGX|VND|VUV|XAF|XOF|XPF)$/;
const THREE_DECIMALS = /^(BHD|IQD|JOD|KWD|LYD|OMR|TND)$/;

/**
 * The ISO 4217 minor-unit exponent and the rounding unit (in minor units) of a currency code. Spec 5.3: COP splits
 * and allocations go by whole pesos; every other currency by its minor unit.
 */
export const minorUnitsOf = (code: string): { readonly exponent: number; readonly roundingUnit: bigint } => ({
  exponent: NO_DECIMALS.test(code) ? 0 : THREE_DECIMALS.test(code) ? 3 : 2,
  roundingUnit: code === "COP" ? 100n : 1n,
});
