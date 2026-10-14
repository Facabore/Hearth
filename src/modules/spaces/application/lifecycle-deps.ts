import type { Clock, TransactionManager } from "@/shared/kernel";
import type { SpaceAccess } from "./space-access";
import type { MemberLifecycleRepository, SpaceMemberRepository } from "./space-member-repository";

/**
 * HU-E5-01 GetMemberNetBalance as spaces sees it: net(m) in minor units, guests included, 0 when nothing
 * moved it. Bound to the balances module by the composition root (balances imports spaces, not the reverse).
 */
export type MemberNetBalance = (spaceId: string, memberId: string) => Promise<bigint>;

/** Leaving, removing guests and archiving (HU-E1-08, HU-E1-09, HU-E1-12) need members, balances and time. */
export interface LifecycleDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent"> & MemberLifecycleRepository;
  readonly netBalance: MemberNetBalance;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
