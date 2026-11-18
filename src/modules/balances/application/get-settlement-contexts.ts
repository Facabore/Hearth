import {
  settlementContexts,
  type DebtExpense,
  type DebtPlace,
  type DebtSettlement,
  type SettlementContext,
} from "../domain/balances";

/** Ruling P339: a space's debt movements with their places in its history, each in its own currency (P342). */
export interface CurrencyDatedDebtMovements {
  readonly expenses: readonly (DebtExpense & DebtPlace)[];
  readonly settlements: readonly (DebtSettlement & DebtPlace)[];
}

/** Ruling P339: a space's debt movements with their places in its history, from the ledger (one read per space). */
export interface DebtHistorySource {
  debtMovements(spaceId: string): Promise<CurrencyDatedDebtMovements>;
}

/** Ruling P339: the payments of one space to describe. */
export interface SettlementContextQuery {
  readonly spaceId: string;
  /** Unused since ruling P342: each payment is replayed in the currency it was paid in. */
  readonly currency?: string;
  readonly settlementIds: readonly string[];
}

export type GetSettlementContexts = (
  queries: readonly SettlementContextQuery[],
) => Promise<ReadonlyMap<string, SettlementContext>>;

/**
 * Ruling P342 (S4): what each asked payment of one space did, replayed against the movements of its own currency
 * alone, since a debt is only ever paid in its currency. A currency Money does not know answers nothing for its
 * payments, and the other currencies still answer.
 */
const contextsIn = (
  movements: CurrencyDatedDebtMovements,
  wanted: ReadonlySet<string>,
): Map<string, SettlementContext> => {
  const found = new Map<string, SettlementContext>();
  const currencies = new Set(
    movements.settlements.filter((s) => wanted.has(s.transactionId)).map((s) => s.currency),
  );
  for (const currency of currencies) {
    const answer = settlementContexts(
      currency,
      {
        expenses: movements.expenses.filter((expense) => expense.currency === currency),
        settlements: movements.settlements.filter((settlement) => settlement.currency === currency),
      },
      wanted,
    );
    if (answer.ok) for (const [id, context] of answer.value) found.set(id, context);
  }
  return found;
};

/**
 * Ruling P339 (S9): what each payment asked about did between its payer and its receiver (`settlementContexts`),
 * computed on read (D7) from one read of each space's debt movements, in the payment's own currency (P342). A payment
 * without one (a forgiveness, a gift, a payment made for someone else, or one in a currency Money does not know) is
 * simply left out. Callers only ask about spaces the person belongs to: the ledger's own lists, which already checked
 * it.
 */
export const createGetSettlementContexts =
  (source: DebtHistorySource): GetSettlementContexts =>
  async (queries) => {
    const found = new Map<string, SettlementContext>();
    const asked = queries.filter((query) => query.settlementIds.length > 0);
    const answers = await Promise.all(
      asked.map(async (query) =>
        contextsIn(await source.debtMovements(query.spaceId), new Set(query.settlementIds)),
      ),
    );
    for (const answer of answers) for (const [id, context] of answer) found.set(id, context);
    return found;
  };
