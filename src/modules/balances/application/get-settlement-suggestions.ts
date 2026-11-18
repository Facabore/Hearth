import { map, type Result } from "@/shared/kernel";
import type { SpaceId } from "@/modules/spaces/application";
import { pairwiseDebtsByCurrency, type SettlementSuggestion } from "../domain/balances";
import {
  createGetSpaceBalances,
  type BalancesDeps,
  type BalanceSource,
  type DebtSource,
} from "./get-space-balances";

export interface SettlementSuggestions {
  readonly spaceId: string;
  /** The space's currency; each suggestion carries its own (ruling P342). */
  readonly currency: string;
  /** Grouped by currency, the space's first, then by ISO code; inside a currency, the largest debt first. */
  readonly suggestions: readonly SettlementSuggestion[];
}

export type GetSettlementSuggestions = (input: {
  spaceId: string;
  userId: string;
}) => Promise<Result<SettlementSuggestions>>;

/** Ruling P323: the suggestions read the space's debt movements besides its balances. */
export interface SettlementSuggestionsDeps extends BalancesDeps {
  readonly source: BalanceSource & DebtSource;
}

/**
 * HU-E5-03, ruling P323: one suggestion per pair of members that owes anything, from the space's movements, computed
 * on read (D7) and never stored; authorized as the balances are, so any member may read them. Ruling P342 (S4): one
 * per pair and currency, in the currency its movements were made in; currencies never net against each other.
 */
export const createGetSettlementSuggestions = (deps: SettlementSuggestionsDeps): GetSettlementSuggestions => {
  const getBalances = createGetSpaceBalances(deps);
  return async (input) => {
    const balances = await getBalances(input);
    if (!balances.ok) return balances;
    const { spaceId, currency } = balances.value;
    const movements = await deps.source.debtMovements(spaceId);
    // Current members only, in join order; a debt to someone who left goes through them (ruling P323).
    const current = (await deps.members.listCurrent(spaceId as SpaceId)).map((member) => member.id);
    return map(pairwiseDebtsByCurrency(currency, current, movements), (suggestions) => ({
      spaceId,
      currency,
      suggestions,
    }));
  };
};
