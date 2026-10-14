import { map, type Result } from "@/shared/kernel";
import { simplifyDebts, type SettlementSuggestion } from "../domain/balances";
import { createGetSpaceBalances, type BalancesDeps } from "./get-space-balances";

export interface SettlementSuggestions {
  readonly spaceId: string;
  readonly currency: string;
  readonly suggestions: readonly SettlementSuggestion[];
}

export type GetSettlementSuggestions = (input: {
  spaceId: string;
  userId: string;
}) => Promise<Result<SettlementSuggestions>>;

/** HU-E5-03: suggestions computed on read from the balances (D7), never stored; any member may read them. */
export const createGetSettlementSuggestions = (deps: BalancesDeps): GetSettlementSuggestions => {
  const getBalances = createGetSpaceBalances(deps);
  return async (input) =>
    map(await getBalances(input), (balances) => ({
      spaceId: balances.spaceId,
      currency: balances.currency,
      suggestions: simplifyDebts(balances.members),
    }));
};
