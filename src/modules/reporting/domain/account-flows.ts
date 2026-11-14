import type { CategoryConsumption } from "./unified-view";

/**
 * Ruling P327: one live movement an account paid, received or moved (P277), as its screen counts it. Only what the
 * account itself did counts: an expense by what it paid of it, any other movement by its whole amount, in or out.
 */
export interface AccountMovement {
  readonly spaceId: string;
  readonly type: "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT";
  readonly categoryId: string | null;
  readonly amount: bigint;
  /** Σ the expense's payments from the account; 0 for any other movement. */
  readonly paid: bigint;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
  /** HU-E4-03: a transfer between the person's own accounts, not a fund contribution (HU-E4-09). */
  readonly betweenOwnAccounts: boolean;
}

/** Ruling P327: what an account did in a period, every figure computed on read (D7). */
export interface AccountFlows {
  /** What the account paid for expenses, per space and category, with how many expenses it paid. */
  readonly paid: readonly (CategoryConsumption & { readonly count: number })[];
  /** Σ what came into the account: incomes, transfers and settlements into it. */
  readonly in: bigint;
  /** Σ what left it: what it paid of expenses, and transfers and settlements out of it. */
  readonly out: bigint;
  /** Σ its transfers to the person's other accounts, which are not spending (D21). */
  readonly movedToOwnAccounts: bigint;
}

/** Ruling P327, D21: an account's movements summed; a transfer between the person's own accounts is never spending. */
export const accountFlows = (accountId: string, movements: readonly AccountMovement[]): AccountFlows => {
  const paid = new Map<string, CategoryConsumption & { count: number; amount: bigint }>();
  let into = 0n;
  let out = 0n;
  let moved = 0n;
  for (const m of movements) {
    if (m.type === "EXPENSE") {
      if (m.paid === 0n) continue;
      out += m.paid;
      if (m.categoryId === null) continue;
      const at = `${m.spaceId}/${m.categoryId}`;
      const row = paid.get(at);
      if (row === undefined)
        paid.set(at, { spaceId: m.spaceId, categoryId: m.categoryId, amount: m.paid, count: 1 });
      else {
        row.amount += m.paid;
        row.count += 1;
      }
      continue;
    }
    // A transfer between two of its own legs never happens (the ledger refuses it), so each movement is in or out.
    if (m.destinationAccountId === accountId) into += m.amount;
    else if (m.sourceAccountId === accountId) {
      out += m.amount;
      if (m.type === "TRANSFER" && m.betweenOwnAccounts) moved += m.amount;
    }
  }
  return { paid: [...paid.values()], in: into, out, movedToOwnAccounts: moved };
};
