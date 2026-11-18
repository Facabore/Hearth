import { memberStandingsByCurrency } from "../domain/balances";
import { netsOf, type BalanceSource, type CurrencyNet } from "./get-space-balances";

/**
 * HU-E5-01 public query GetMemberNetBalance, consumed by spaces for HU-E1-08, HU-E1-09 and HU-E1-12:
 * net(m) of one member of one space, guests included. Ruling P342 (S4): one net per currency, never converted, only
 * the non-zero ones (none when nothing moved it), `spaceCurrency` first, then by ISO code (by ISO code alone without
 * it). It does not authorize; its callers authorize before asking.
 */
export type GetMemberNetBalance = (
  spaceId: string,
  memberId: string,
  spaceCurrency?: string,
) => Promise<CurrencyNet[]>;

/** No currency is coded "": its group is all zeros, which `netsOf` drops, so the rest go by ISO code alone. */
const NO_CURRENCY = "";

export const createGetMemberNetBalance =
  (source: BalanceSource): GetMemberNetBalance =>
  async (spaceId, memberId, spaceCurrency = NO_CURRENCY) =>
    netsOf(
      memberStandingsByCurrency(spaceCurrency, [memberId], await source.memberTotals(spaceId)),
      memberId,
    );

/** The nets of several members of one space, in the given order, from one aggregate (HU-E1-09); per currency (P342). */
export type GetMemberNetBalances = (
  spaceId: string,
  memberIds: readonly string[],
  spaceCurrency?: string,
) => Promise<CurrencyNet[][]>;

export const createGetMemberNetBalances =
  (source: BalanceSource): GetMemberNetBalances =>
  async (spaceId, memberIds, spaceCurrency = NO_CURRENCY) => {
    const byCurrency = memberStandingsByCurrency(
      spaceCurrency,
      memberIds,
      await source.memberTotals(spaceId),
    );
    return memberIds.map((id) => netsOf(byCurrency, id));
  };
