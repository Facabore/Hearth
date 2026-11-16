let known: readonly string[] | null = null;

/**
 * D29 (board 13): the ISO 4217 currencies the sheet offers: the ones the runtime knows (`Intl.supportedValuesOf`), in
 * code order. The SPA may not read the kernel's list (ruling P119 lets it import only `minor-units.ts` of it), and the
 * two match but for a handful of codes either side; the server still decides, refusing a code the kernel does not know
 * with UnknownCurrency.
 */
export const knownCurrencyCodes = (): readonly string[] => {
  known ??= [...Intl.supportedValuesOf("currency")].sort();
  return known;
};
