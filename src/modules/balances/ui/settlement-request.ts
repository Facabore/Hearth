import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import type { SettlementDraft } from "./settlement-prefill";

export { prefillOf, type SettlementDraft } from "./settlement-prefill";

export type SettlementField = "payer" | "receiver" | "amount" | "gift" | "leg";

/** Minor units of a typed amount in `currency`, or null when it does not read as one. */
const minorIn = (typed: string, currency: string, numberFormat: NumberFormat): string | null => {
  const decimal = parseDecimal(typed, numberFormat);
  return decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
};

/**
 * HU-E5-02, ruling P174: a settlement recorded now. An account is named only on the viewer's own side, where it is one
 * of theirs (D9: only its owner debits it); a guest pays and receives without one (D15).
 *
 * Ruling P322: a payment for someone else names that member and whether it is a gift; a forgiveness names no account,
 * since no money moves. A draft with neither sends exactly the body it sent before.
 *
 * Ruling P342 (S5): the amount is in the draft's currency (the debt's), the space's when it has none. An exchange
 * (board 3) sends what really moved in the other currency on the viewer's side, `destinationAmount` when they received
 * into their account and `sourceAmount` when they paid from theirs; it needs that account, in that currency.
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
  const currency = draft.currency ?? input.currency;
  const minor = minorIn(draft.amount, currency, input.numberFormat);
  if (minor === null) return { ok: false, field: "amount" };
  const body: Record<string, unknown> = {
    ...input.when,
    amount: { amount: minor, currency },
    payerMemberId,
    receivingMemberId,
  };
  if (draft.reason === "FORGIVENESS") return { ok: true, body: { ...body, reason: "FORGIVENESS" } };
  if (draft.onBehalfOfMemberId) {
    body.onBehalfOfMemberId = draft.onBehalfOfMemberId;
    body.gift = draft.gift === true;
  }
  if (payerMemberId === input.meMemberId && draft.sourceAccountId)
    body.sourceAccountId = draft.sourceAccountId;
  if (receivingMemberId === input.meMemberId && draft.destinationAccountId)
    body.destinationAccountId = draft.destinationAccountId;
  const { legCurrency } = draft;
  if (!legCurrency || legCurrency === currency || draft.onBehalfOfMemberId) return { ok: true, body };
  const side =
    receivingMemberId === input.meMemberId
      ? ({ account: "destinationAccountId", leg: "destinationAmount" } as const)
      : payerMemberId === input.meMemberId
        ? ({ account: "sourceAccountId", leg: "sourceAmount" } as const)
        : null;
  if (side === null) return { ok: true, body };
  const leg = minorIn(draft.legAmount ?? "", legCurrency, input.numberFormat);
  if (leg === null || body[side.account] === undefined) return { ok: false, field: "leg" };
  body[side.leg] = { amount: leg, currency: legCurrency };
  return { ok: true, body };
};

const BY_CODE: Readonly<Record<string, SettlementField>> = {
  InvalidAmount: "amount",
  CurrencyMismatch: "amount",
  ExchangeAccountRequired: "leg",
  ExchangeRateRequired: "leg",
  InvalidSettlementParties: "receiver",
  NotASpaceMember: "payer",
  GuestHasNoAccounts: "payer",
  AccountNotOwned: "payer",
  AccountArchived: "payer",
  InvalidOnBehalfOf: "payer",
  GiftRequiresOnBehalfOf: "gift",
};
const BY_PATH: Readonly<Record<string, SettlementField>> = {
  amount: "amount",
  payerMemberId: "payer",
  sourceAccountId: "payer",
  receivingMemberId: "receiver",
  destinationAccountId: "receiver",
  onBehalfOfMemberId: "payer",
  gift: "gift",
  sourceAmount: "leg",
  destinationAmount: "leg",
};

/** Ruling P118: the field an API problem belongs to, else the form. */
export const settlementFieldOf = (problem: Problem): SettlementField | "form" =>
  BY_CODE[problem.code] ??
  (problem.code === "ValidationFailed" ? BY_PATH[problem.errors[0]?.path.split(".")[0] ?? ""] : undefined) ??
  "form";
