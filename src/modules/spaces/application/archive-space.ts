import { ok, type Result } from "@/shared/kernel";
import { ensureArchivable } from "../domain/space";
import { ensureSettledInEveryCurrency, type CurrencyNet, type LifecycleDeps } from "./lifecycle-deps";
import { authorizeSpaceAction } from "./space-access";
import type { SpaceArchiveRepository } from "./space-repository";

/**
 * HU-E5-01 net(m) of the given members of one space, in that order, read from one aggregate so that they
 * come from one snapshot; each member's non-zero nets, one per currency (ruling P342). Bound to the balances module
 * by the composition root (balances imports spaces).
 */
export type MemberNetBalances = (
  spaceId: string,
  memberIds: readonly string[],
  spaceCurrency: string,
) => Promise<readonly (readonly CurrencyNet[])[]>;

export type ArchiveSpace = (input: { spaceId: string; userId: string }) => Promise<Result<void>>;

export type ArchiveSpaceDeps = Omit<LifecycleDeps, "netBalance"> & {
  readonly spaces: SpaceArchiveRepository;
  readonly netBalances: MemberNetBalances;
};

/**
 * HU-E1-09: the OWNER archives a shared or direct space once every current member, registered or guest,
 * is settled in every currency (ruling P342); the space then only reads (SpaceAccess). Personal spaces are never archived.
 */
export const createArchiveSpace =
  (deps: ArchiveSpaceDeps): ArchiveSpace =>
  (input) =>
    deps.tm.run(async () => {
      const owner = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.archive");
      if (!owner.ok) return owner;
      const { spaceId, spaceKind, currency } = owner.value;
      const archivable = ensureArchivable({ kind: spaceKind });
      if (!archivable.ok) return archivable;
      // Issue #89: first lock of the transaction: money writes already inside finish before the nets are read, and
      // later ones find the space archived.
      await deps.spaceLocks.lockForLifecycle(spaceId);
      const current = await deps.members.listCurrent(spaceId);
      const nets = await deps.netBalances(
        spaceId,
        current.map((m) => m.id),
        currency,
      );
      const settled = ensureSettledInEveryCurrency(currency, nets);
      if (!settled.ok) return settled;
      await deps.spaces.archive(spaceId, deps.clock.now());
      return ok(undefined);
    });
