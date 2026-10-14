import {
  authorizeSpaceAction,
  type SpaceAccess,
  type SpaceMemberRepository,
} from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import { netBalances, type MemberBalance, type MemberTotals } from "../domain/balances";

/** Per-member totals of one space's live ledger (E5 balance rule); bound to the ledger by the composition root. */
export interface BalanceSource {
  memberTotals(spaceId: string): Promise<readonly MemberTotals[]>;
}

export interface BalancesDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly source: BalanceSource;
}

export interface SpaceBalances {
  readonly spaceId: string;
  readonly currency: string;
  /** Current members in join order, guests included; the nets sum to zero. */
  readonly members: readonly MemberBalance[];
}

export type GetSpaceBalances = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceBalances>>;

/** HU-E5-01: who owes whom, computed on read (D7); any member may read, non-members get SpaceNotFound. */
export const createGetSpaceBalances =
  (deps: BalancesDeps): GetSpaceBalances =>
  async ({ spaceId, userId }) => {
    const reader = await authorizeSpaceAction(deps.access, spaceId, userId, "space.read");
    if (!reader.ok) return reader;
    const space = reader.value;
    const members = await deps.members.listCurrent(space.spaceId);
    const totals = await deps.source.memberTotals(space.spaceId);
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      members: netBalances(
        members.map((m) => m.id),
        totals,
      ),
    });
  };
