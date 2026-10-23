import type { SuggestionDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type NumberFormat } from "@/shared/ui/format/formatters";

export interface SettlementDraft {
  readonly payerMemberId: string | null;
  readonly receivingMemberId: string | null;
  /** As typed, in the person's number format. */
  readonly amount: string;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
}
export type SettlementField = "payer" | "receiver" | "amount";

/**
 * HU-E5-02, ruling P174: a settlement recorded now. An account is named only on the viewer's own side, where it is one
 * of theirs (D9: only its owner debits it); a guest pays and receives without one (D15).
 */
export const settlementRequestOf = (
  draft: SettlementDraft,
  input: {
    readonly currency: string;
    readonly numberFormat: NumberFormat;
    readonly meMemberId: string;
    readonly when: { readonly date: string; readonly occurredAt: string; readonly timeZone: string };
  },
): { ok: true; body: Record<string, unknown> } | { ok: false; field: SettlementField } => {
  const { payerMemberId, receivingMemberId } = draft;
  if (!payerMemberId) return { ok: false, field: "payer" };
  if (!receivingMemberId || receivingMemberId === payerMemberId) return { ok: false, field: "receiver" };
  const decimal = parseDecimal(draft.amount, input.numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, currencyOf(input.currency).exponent);
  if (minor === null) return { ok: false, field: "amount" };
  const body: Record<string, unknown> = {
    ...input.when,
    amount: { amount: minor, currency: input.currency },
    payerMemberId,
    receivingMemberId,
  };
  if (payerMemberId === input.meMemberId && draft.sourceAccountId)
    body.sourceAccountId = draft.sourceAccountId;
  if (receivingMemberId === input.meMemberId && draft.destinationAccountId)
    body.destinationAccountId = draft.destinationAccountId;
  return { ok: true, body };
};

const BY_CODE: Readonly<Record<string, SettlementField>> = {
  InvalidAmount: "amount",
  CurrencyMismatch: "amount",
  InvalidSettlementParties: "receiver",
  NotASpaceMember: "payer",
  GuestHasNoAccounts: "payer",
  AccountNotOwned: "payer",
  AccountArchived: "payer",
};
const BY_PATH: Readonly<Record<string, SettlementField>> = {
  amount: "amount",
  payerMemberId: "payer",
  sourceAccountId: "payer",
  receivingMemberId: "receiver",
  destinationAccountId: "receiver",
};

/** Ruling P118: the field an API problem belongs to, else the form. */
export const settlementFieldOf = (problem: Problem): SettlementField | "form" =>
  BY_CODE[problem.code] ??
  (problem.code === "ValidationFailed" ? BY_PATH[problem.errors[0]?.path.split(".")[0] ?? ""] : undefined) ??
  "form";

/** Ruling P175: a suggestion fills in payer, receiver and amount; otherwise the viewer receives, from `payerMemberId`. */
export const prefillOf = (input: {
  readonly suggestion: SuggestionDto | null;
  readonly payerMemberId?: string | null;
  readonly meMemberId: string;
  readonly currency: string;
  readonly numberFormat: NumberFormat;
}): SettlementDraft => {
  const { suggestion } = input;
  const amount = suggestion
    ? formatNumber(decimalOf(suggestion.amount.amount, currencyOf(input.currency).exponent), input)
    : "";
  return {
    payerMemberId: suggestion?.payerMemberId ?? input.payerMemberId ?? null,
    receivingMemberId: suggestion?.receivingMemberId ?? input.meMemberId,
    amount,
    sourceAccountId: null,
    destinationAccountId: null,
  };
};
