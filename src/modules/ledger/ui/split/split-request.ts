import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { previewSplit, type ParticipantValue, type SplitCheck, type SplitMethod } from "./split-math";

/**
 * Ruling P168 (D9): who paid. The recorder pays from an account they own; a guest pays outside the app (no account);
 * a shared fund pays with no payer member (HU-E4-10). Another registered member cannot be the payer: only an
 * account's owner may record its debit.
 */
export type Payer =
  | { readonly kind: "ME"; readonly memberId: string; readonly accountId: string | null }
  | { readonly kind: "GUEST"; readonly memberId: string }
  | { readonly kind: "FUND"; readonly accountId: string }
  /**
   * D26, P328: "pagaste por el fondo": the recorder pays from their account for the fund, which Hearth records as their
   * contribution to it and the fund's payment of the expense.
   */
  | {
      readonly kind: "FOR_FUND";
      readonly memberId: string;
      readonly accountId: string | null;
      readonly fundAccountId: string;
    };

export interface SplitDraft {
  readonly payer: Payer;
  readonly method: SplitMethod;
  readonly selected: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  /** The person picked the method; until then the default split (HU-E6-08) may set it (ruling P167). */
  readonly chosen: boolean;
  /** P328: the person picked who paid; until then the line's payers (D26) may propose "pagaste por el fondo". */
  readonly payerChosen?: boolean;
}

/** The selected members in the space's join order, with what was typed for each. */
export const participantsOf = (draft: SplitDraft, memberIds: readonly string[]): ParticipantValue[] =>
  memberIds
    .filter((id) => draft.selected.includes(id))
    .map((memberId) => ({ memberId, value: draft.values[memberId] ?? "" }));

/** The preview to show: null while there is no amount, or while the plan's split waits for the API's shares. */
export const splitCheckOf = (
  draft: SplitDraft,
  input: {
    readonly amount: string | null;
    readonly currency: string;
    readonly numberFormat: NumberFormat;
    readonly memberIds: readonly string[];
    readonly allocation: readonly { readonly memberId: string; readonly amount: string }[] | null;
  },
): SplitCheck | null => {
  if (input.amount === null) return null;
  if (draft.method === "BY_ALLOCATION")
    return input.allocation === null ? null : { ok: true, shares: input.allocation };
  return previewSplit({
    ...input,
    amount: input.amount,
    method: draft.method,
    participants: participantsOf(draft, input.memberIds),
  });
};

/**
 * HU-E9-06: the `payments` and `split` of a shared expense; no `split` for BY_ALLOCATION (the server applies it). D26:
 * an expense paid for the fund sends `paidForFund` instead of `payments`.
 */
export const sharedPartsOf = (
  draft: SplitDraft,
  input: {
    readonly amount: string;
    readonly currency: string;
    readonly numberFormat: NumberFormat;
    readonly memberIds: readonly string[];
  },
):
  | {
      ok: true;
      payments: readonly Record<string, unknown>[] | null;
      paidForFund?: Record<string, unknown>;
      split: Record<string, unknown> | null;
    }
  | { ok: false; field: "payer" | "split" } => {
  const amount = { amount: input.amount, currency: input.currency };
  const { payer } = draft;
  if ((payer.kind === "ME" || payer.kind === "FOR_FUND") && !payer.accountId)
    return { ok: false, field: "payer" };
  const paid =
    payer.kind === "FOR_FUND"
      ? {
          payments: null,
          paidForFund: { fundAccountId: payer.fundAccountId, sourceAccountId: payer.accountId },
        }
      : {
          payments: [
            payer.kind === "FUND"
              ? { memberId: null, accountId: payer.accountId, amount }
              : payer.kind === "GUEST"
                ? { memberId: payer.memberId, accountId: null, amount }
                : { memberId: payer.memberId, accountId: payer.accountId, amount },
          ],
        };
  if (draft.method === "BY_ALLOCATION") return { ok: true, ...paid, split: null };
  const participants = participantsOf(draft, input.memberIds);
  const check = previewSplit({ ...input, method: draft.method, participants });
  if (!check.ok) return { ok: false, field: "split" };
  const { exponent } = currencyOf(input.currency);
  const typed = (value: string) => parseDecimal(value, input.numberFormat)!;
  const method = draft.method;
  return {
    ok: true,
    ...paid,
    split: {
      method,
      participants: participants.map(({ memberId, value }) =>
        method === "EQUAL"
          ? { memberId }
          : method === "PERCENT"
            ? { memberId, percent: typed(value) }
            : method === "EXACT"
              ? { memberId, amount: { amount: minorOf(typed(value), exponent)!, currency: input.currency } }
              : { memberId, units: Number(value.trim()) },
      ),
    },
  };
};
