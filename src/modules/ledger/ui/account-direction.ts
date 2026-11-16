import type { MoneyDto, TransactionDto } from "@/shared/ui/api/dto";

/**
 * Ruling P327: the account whose own screen lists a row. The row's amount is then what that account moved, signed by
 * its direction: "−$ 64.000" when it paid or sent, "+$ 3.200.000" when it received.
 */
export interface AccountView {
  readonly id: string;
  /** A shared fund, whose expenses read "pagó el fondo". */
  readonly fund: boolean;
  /** The viewer's own accounts by id, which a contribution into a fund comes from (P168). */
  readonly ownAccountNames?: Readonly<Record<string, string>>;
}

type Moved = Pick<
  TransactionDto,
  | "type"
  | "amount"
  | "payments"
  | "sourceAccountId"
  | "destinationAccountId"
  | "sourceAmount"
  | "destinationAmount"
>;

/** Ruling P327: what `accountId` moved in `tx` and which way: an expense by what it paid of it, else the whole amount. */
export const movedBy = (
  tx: Moved,
  accountId: string,
): { readonly amount: MoneyDto; readonly sign: "+" | "-" } => {
  if (tx.type === "EXPENSE") {
    const paid = tx.payments
      .filter((p) => p.accountId === accountId)
      .reduce((sum, p) => sum + BigInt(p.amount.amount), 0n);
    return {
      amount: paid === 0n ? tx.amount : { amount: paid.toString(), currency: tx.amount.currency },
      sign: "-",
    };
  }
  const into = tx.destinationAccountId === accountId;
  // Design Q4: a balance adjustment moved its one account by its leg, in the account's own currency when it has one.
  if (tx.type === "ADJUSTMENT") {
    return { amount: (into ? tx.destinationAmount : tx.sourceAmount) ?? tx.amount, sign: into ? "+" : "-" };
  }
  return { amount: tx.amount, sign: into ? "+" : "-" };
};
