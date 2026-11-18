import type { SuggestionDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type NumberFormat } from "@/shared/ui/format/formatters";

// The settle-up sheet's draft and how a suggestion fills it in, apart from the request it becomes: the balances screen
// opens the sheet from these alone, so it never loads the amount parsing that only the lazy sheet needs (#296).

export interface SettlementDraft {
  readonly payerMemberId: string | null;
  readonly receivingMemberId: string | null;
  /** As typed, in the person's number format, in `currency`. */
  readonly amount: string;
  /** Ruling P342 (S5): the debt's currency, the payment's; absent, the space's. */
  readonly currency?: string;
  /**
   * Ruling P342 (S5, board 3): the other currency the money really moved in, an explicit exchange, and what moved in
   * it as typed (absent until typed: the sheet then shows the server's conversion). Only the viewer's side has one.
   */
  readonly legCurrency?: string | null;
  readonly legAmount?: string;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
  /** Ruling P322 ("Lo pago yo"): the member whose debt the viewer pays; absent when the payer pays their own. */
  readonly onBehalfOfMemberId?: string | null;
  /** Ruling P322 ("Se lo regalo"): with `onBehalfOfMemberId`, the payer gives the payment away. */
  readonly gift?: boolean;
  /** Ruling P322 (board B8): FORGIVENESS records that the receiver forgave the payer's debt; no money moves. */
  readonly reason?: "PAYMENT" | "FORGIVENESS";
}

/**
 * Ruling P175: a suggestion fills in payer, receiver and amount; otherwise the viewer receives, from `payerMemberId`.
 * Ruling P342 (S5): a suggestion's amount stays in its own currency; with none, the payment is in the space's.
 */
export const prefillOf = (input: {
  readonly suggestion: SuggestionDto | null;
  readonly payerMemberId?: string | null;
  readonly meMemberId: string;
  readonly currency: string;
  readonly numberFormat: NumberFormat;
}): SettlementDraft => {
  const { suggestion } = input;
  const currency = suggestion?.amount.currency ?? input.currency;
  const amount = suggestion
    ? formatNumber(decimalOf(suggestion.amount.amount, currencyOf(currency).exponent), input)
    : "";
  return {
    payerMemberId: suggestion?.payerMemberId ?? input.payerMemberId ?? null,
    receivingMemberId: suggestion?.receivingMemberId ?? input.meMemberId,
    amount,
    currency,
    sourceAccountId: null,
    destinationAccountId: null,
  };
};
