import { useTranslations } from "next-intl";

/** Who paid, as Registrar's row names it (P333). */
export type WhoPaidLinePayer =
  | { readonly kind: "ME"; readonly account: string | null }
  | { readonly kind: "FOR_FUND"; readonly fund: string; readonly account: string | null }
  /** Someone else or a fund; `owesThem` when what the recorder owes is owed to them (not to a fund). */
  | { readonly kind: "OTHER"; readonly name: string; readonly owesThem?: boolean };

export interface WhoPaidLineInput {
  readonly payer: WhoPaidLinePayer;
  /** Whether the expense was for the recorder too. */
  readonly meIncluded: boolean;
  /** Everyone else it was for, by name, in order. */
  readonly others: readonly string[];
  /** The recorder's part, already formatted, when known. */
  readonly myShare: string | null;
}

/**
 * P333, board "Registrar: una fila": "Pagaste tú con Bancolombia · para Juan y Ana", "Pagó Juan · le debes $ 75.000",
 * "Pagaste por Fondo Hogar con Bancolombia · para ti y Juan". Only the recorder's own expense says no "para".
 */
export const useWhoPaidLine = () => {
  const t = useTranslations("ledger.who");
  return ({ payer, meIncluded, others, myShare }: WhoPaidLineInput): string => {
    const paid =
      payer.kind === "ME"
        ? payer.account === null
          ? t("youPaidNoAccount")
          : t("youPaid", { account: payer.account })
        : payer.kind === "FOR_FUND"
          ? t("forFundPaid", { fund: payer.fund, account: payer.account ?? "" })
          : t("paidBy", { payer: payer.name });
    // Someone else paid and the recorder took part: what they owe that person is the news.
    if (payer.kind === "OTHER" && payer.owesThem && meIncluded && myShare !== null)
      return `${paid} · ${t("youOweAmount", { amount: myShare })}`;
    const names = [...(meIncluded ? [t("ti")] : []), ...others];
    if (names.length === 0 || (payer.kind === "ME" && others.length === 0)) return paid;
    const forWhom =
      names.length === 1
        ? t("for.one", { a: names[0]! })
        : names.length === 2
          ? t("for.two", { a: names[0]!, b: names[1]! })
          : t("for.many", { count: names.length });
    return `${paid} · ${forWhom}`;
  };
};
