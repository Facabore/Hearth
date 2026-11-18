import { ok, type Clock, type Result, type TransactionManager } from "@/shared/kernel";
import { ensureSettled, outstandingIn } from "../domain/member";
import type { SpaceAccess } from "./space-access";
import type { SpaceLocks } from "./space-locks";
import type { MemberLifecycleRepository, SpaceMemberRepository } from "./space-member-repository";

/** Ruling P342: a member's net in one currency, in its minor units. */
export interface CurrencyNet {
  readonly currency: string;
  readonly net: bigint;
}

/**
 * HU-E5-01 GetMemberNetBalance as spaces sees it: net(m), guests included, one per currency it is not zero in (none
 * when nothing moved it), never converted (ruling P342). Bound to the balances module by the composition root
 * (balances imports spaces, not the reverse).
 */
export type MemberNetBalance = (
  spaceId: string,
  memberId: string,
  spaceCurrency: string,
) => Promise<readonly CurrencyNet[]>;

/** Ruling P342: the space currency first, then every other one by ISO code. */
const currencyOrder =
  (spaceCurrency: string) =>
  (x: string, y: string): number =>
    x === y ? 0 : x === spaceCurrency ? -1 : y === spaceCurrency ? 1 : x < y ? -1 : 1;

/**
 * HU-E1-08, HU-E1-09, HU-E1-12 under ruling P342 (S4): money is settled only when it is in every currency, since a
 * currency never pays off another. `nets` holds each member's nets; the first currency still outstanding, the space's
 * first and then by ISO code, is the one the OutstandingBalance error states.
 */
export const ensureSettledInEveryCurrency = (
  spaceCurrency: string,
  nets: readonly (readonly CurrencyNet[])[],
): Result<void> => {
  const byCurrency = new Map<string, bigint[]>();
  for (const member of nets)
    for (const { currency, net } of member)
      byCurrency.set(currency, [...(byCurrency.get(currency) ?? []), net]);
  for (const currency of [...byCurrency.keys()].sort(currencyOrder(spaceCurrency))) {
    const settled = ensureSettled(outstandingIn(byCurrency.get(currency) ?? []), currency);
    if (!settled.ok) return settled;
  }
  return ok(undefined);
};

/** Leaving, removing guests and archiving (HU-E1-08, HU-E1-09, HU-E1-12) need members, balances and time. */
export interface LifecycleDeps {
  readonly access: SpaceAccess;
  /** Issue #89: the space row is locked before the balance check, so no money write interleaves with it. */
  readonly spaceLocks: Pick<SpaceLocks, "lockForLifecycle">;
  readonly members: Pick<SpaceMemberRepository, "listCurrent"> & MemberLifecycleRepository;
  readonly netBalance: MemberNetBalance;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
