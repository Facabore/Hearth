import { map, type Result } from "@/shared/kernel";
import type { SpaceId } from "@/modules/spaces/application";
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
    const { spaceId, currency } = balances.value;
    const movements = await deps.source.debtMovements(spaceId);
    // Current members only, in join order; a debt to someone who left goes through them (ruling P323).
    const current = (await deps.members.listCurrent(spaceId as SpaceId)).map((member) => member.id);
    return map(pairwiseDebts(currency, current, movements), (suggestions) => ({
      spaceId,
      currency,
      suggestions,
    }));
  };
};
