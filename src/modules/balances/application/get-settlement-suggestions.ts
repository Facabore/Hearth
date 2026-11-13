import { map, type Result } from "@/shared/kernel";
import { pairwiseDebts, type SettlementSuggestion } from "../domain/balances";
import {
  createGetSpaceBalances,
  type BalancesDeps,
  type BalanceSource,
  type DebtSource,
} from "./get-space-balances";

export interface SettlementSuggestions {
  readonly spaceId: string;
  readonly currency: string;
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
 * on read (D7) and never stored; authorized as the balances are, so any member may read them.
 */
export const createGetSettlementSuggestions = (deps: SettlementSuggestionsDeps): GetSettlementSuggestions => {
  const getBalances = createGetSpaceBalances(deps);
  return async (input) => {
    const balances = await getBalances(input);
    if (!balances.ok) return balances;
    const { spaceId, currency, members } = balances.value;
    const movements = await deps.source.debtMovements(spaceId);
    const order = members.map((m) => m.memberId);
    return map(pairwiseDebts(currency, order, movements), (suggestions) => ({
      spaceId,
      currency,
      suggestions,
    }));
  };
};
