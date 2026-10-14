import { ok, type Result } from "@/shared/kernel";
import { ensureSettled, outstandingIn } from "../domain/member";
import { ensureArchivable } from "../domain/space";
import type { LifecycleDeps } from "./lifecycle-deps";
import { authorizeSpaceAction } from "./space-access";
import type { SpaceArchiveRepository } from "./space-repository";

/**
 * HU-E5-01 net(m) of the given members of one space, in that order, read from one aggregate so that they
 * come from one snapshot; bound to the balances module by the composition root (balances imports spaces).
 */
export type MemberNetBalances = (spaceId: string, memberIds: readonly string[]) => Promise<bigint[]>;

export type ArchiveSpace = (input: { spaceId: string; userId: string }) => Promise<Result<void>>;

export type ArchiveSpaceDeps = Omit<LifecycleDeps, "netBalance"> & {
  readonly spaces: SpaceArchiveRepository;
  readonly netBalances: MemberNetBalances;
};

/**
 * HU-E1-09: the OWNER archives a shared or direct space once every current member, registered or guest,
 * is settled; the space then only reads (SpaceAccess). Personal spaces are never archived.
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
      const current = await deps.members.listCurrent(spaceId);
      const nets = await deps.netBalances(
        spaceId,
        current.map((m) => m.id),
      );
      const settled = ensureSettled(outstandingIn(nets), currency);
      if (!settled.ok) return settled;
      await deps.spaces.archive(spaceId, deps.clock.now());
      return ok(undefined);
    });
