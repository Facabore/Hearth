import {
  BUILT_IN_FORMATS,
  formatMoney,
  formatPercent,
  type Formats,
} from "../../../src/shared/ui/format/formatters";

/** "2,000,000" (the stories' pesos) → "200000000" minor units; a sign and two decimals are kept. */
export const minor = (pesos: string): string => {
  const negative = pesos.trim().startsWith("-");
  const [whole = "0", fraction = ""] = pesos.replace(/[-,\s]/g, "").split(".");
  const digits = `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  return negative && digits !== "0" ? `-${digits}` : digits;
};

/** The amount as the screen writes it, through the app's own formatter (never re-implemented here). */
export const shown = (pesos: string, formats: Formats = BUILT_IN_FORMATS): string =>
  formatMoney({ amount: minor(pesos), currency: "COP" }, formats);

/** A share as the screen writes it ("40.00" → "40,00 %"), through the app's own formatter. */
export const percentShown = (decimal: string, formats: Formats = BUILT_IN_FORMATS): string =>
  formatPercent(decimal, formats);
