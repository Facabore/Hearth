import { settlementContexts, type DatedDebtMovements, type SettlementContext } from "../domain/balances";

/** Ruling P339: a space's debt movements with their places in its history, from the ledger (one read per space). */
export interface DebtHistorySource {
  debtMovements(spaceId: string): Promise<DatedDebtMovements>;
}

/** Ruling P339: the payments of one space to describe, and the space's currency. */
export interface SettlementContextQuery {
  readonly spaceId: string;
  readonly currency: string;
  readonly settlementIds: readonly string[];
}

export type GetSettlementContexts = (
  queries: readonly SettlementContextQuery[],
) => Promise<ReadonlyMap<string, SettlementContext>>;

/**
 * Ruling P339 (S9): what each payment asked about did between its payer and its receiver (`settlementContexts`),
 * computed on read (D7) from one read of each space's debt movements. A payment without one (a forgiveness, a gift, a
 * payment made for someone else, or a space whose currency Money does not know) is simply left out. Callers only ask
 * about spaces the person belongs to: the ledger's own lists, which already checked it.
 */
export const createGetSettlementContexts =
  (source: DebtHistorySource): GetSettlementContexts =>
  async (queries) => {
    const found = new Map<string, SettlementContext>();
    const asked = queries.filter((query) => query.settlementIds.length > 0);
    const answers = await Promise.all(
      asked.map(async (query) =>
        settlementContexts(
          query.currency,
          await source.debtMovements(query.spaceId),
          new Set(query.settlementIds),
        ),
      ),
    );
    for (const answer of answers)
      if (answer.ok) for (const [id, context] of answer.value) found.set(id, context);
    return found;
  };
