import { knownCurrency } from "@/shared/kernel/currency";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
let known: readonly string[] | null = null;

/**
 * D29: every currency code the kernel knows (`knownCurrency`), in code order. The kernel keeps its list private, so the
 * list is read back through its lookup, once: 26³ map lookups, well under a millisecond, and never a second list here.
 */
export const knownCurrencyCodes = (): readonly string[] => {
  if (known !== null) return known;
  const codes: string[] = [];
  for (const a of LETTERS)
    for (const b of LETTERS)
      for (const c of LETTERS) if (knownCurrency(`${a}${b}${c}`) !== undefined) codes.push(`${a}${b}${c}`);
  known = codes;
  return codes;
};
