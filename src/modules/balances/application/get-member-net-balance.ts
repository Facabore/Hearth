import { netOf } from "../domain/balances";
import type { BalanceSource } from "./get-space-balances";

/**
 * HU-E5-01 public query GetMemberNetBalance, consumed by spaces for HU-E1-08, HU-E1-09 and HU-E1-12:
 * net(m) of one member of one space, guests included, 0 when nothing moved it. It does not authorize;
 * its callers authorize before asking.
 */
export type GetMemberNetBalance = (spaceId: string, memberId: string) => Promise<bigint>;

export const createGetMemberNetBalance =
  (source: BalanceSource): GetMemberNetBalance =>
  async (spaceId, memberId) => {
    const totals = (await source.memberTotals(spaceId)).find((t) => t.memberId === memberId);
    return totals === undefined ? 0n : netOf(totals);
  };
