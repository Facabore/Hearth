import { formatMoney, NBSP, type Formats } from "./formatters";

/** D29, slice MC4: the “almost equal to” sign a converted total carries; a no-break space keeps it with its amount. */
export const APPROX = "≈";

/**
 * D29, slice MC4 (design §4): a total converted from other currencies, written “≈ 6.000.000 COP”: the “almost equal to”
 * sign, a no-break space, then the amount, all one unbreakable run. The amount’s own sign and spacing are formatMoney’s.
 * It lives apart from formatters so only screens that show a converted total (the accounts list) carry it (ADR 0004).
 */
export const formatApproximateMoney = (
  money: { readonly amount: string; readonly currency: string },
  f: Pick<Formats, "numberFormat">,
): string => `${APPROX}${NBSP}${formatMoney(money, f)}`;
