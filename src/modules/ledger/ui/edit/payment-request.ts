import type { TransactionDto } from "@/shared/ui/api/dto";

/** P344: a payment's two sides as the edit holds them: each side's member, and its account when it has one. */
export interface PaymentSides {
  readonly payerMemberId: string | null;
  readonly receivingMemberId: string | null;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
}

/**
 * Ruling P344 (S2, S3): a settlement's PATCH body, only what changed. A side moved to another member sends its member
 * alone, so it has no account (the API nulls it); a side that is the editor's sends the account they chose, or none; a
 * side whose member stays and is someone else's never sends an account, so it keeps its own.
 */
export const paymentEditBodyOf = (input: {
  readonly tx: TransactionDto;
  readonly meMemberId: string;
  readonly current: PaymentSides;
  /** The amount typed, in minor units of the payment's currency, or null when it is unreadable. */
  readonly amount: string | null;
  /** The new moment, only when the person changed it. */
  readonly when: { readonly date: string; readonly occurredAt: string; readonly timeZone: string } | null;
}): Record<string, unknown> => {
  const { tx, meMemberId, current } = input;
  const body: Record<string, unknown> = {};
  if (input.amount !== null && input.amount !== tx.amount.amount)
    body.amount = { amount: input.amount, currency: tx.amount.currency };
  if (input.when) Object.assign(body, input.when);
  const sides = [
    ["payerMemberId", "sourceAccountId"],
    ["receivingMemberId", "destinationAccountId"],
  ] as const;
  for (const [memberKey, accountKey] of sides) {
    const moved = current[memberKey] !== tx[memberKey];
    if (moved) body[memberKey] = current[memberKey];
    if (current[memberKey] !== meMemberId) continue;
    if (moved ? current[accountKey] !== null : current[accountKey] !== tx[accountKey])
      body[accountKey] = current[accountKey];
  }
  return body;
};
