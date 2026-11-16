import { authorizeSpaceAction, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { ImportBatch } from "../domain/import-batch";
import type { ImportDeps, ImportLink } from "./import-ports";

/**
 * Design §3.2: only a member who records money (`money.record`) imports, a VIEWER does not; and a Money Manager file is
 * one person's money, so it goes into the importer's personal space only (design §2.3): `ImportRequiresPersonalSpace`.
 */
export const authorizeImporter = async (
  deps: Pick<ImportDeps, "access">,
  spaceId: string,
  userId: string,
): Promise<Result<SpaceMembership>> => {
  const membership = await authorizeSpaceAction(deps.access, spaceId, userId, "money.record");
  if (!membership.ok) return membership;
  return membership.value.spaceKind === "PERSONAL"
    ? membership
    : err(domainError("ImportRequiresPersonalSpace"));
};

/** A batch of the space that the requester uploaded; anyone else's, or none, is `ImportNotFound`. */
export const ownBatch = (batch: ImportBatch | null, userId: string): Result<ImportBatch> =>
  batch === null || batch.userId !== userId ? err(domainError("ImportNotFound")) : ok(batch);

/** Design §3.3: what earlier imports linked each source account and category to (folded adjustments left out). */
export const priorLinksOf = (links: readonly ImportLink[]) => ({
  accounts: new Map(
    links
      .filter((l) => l.entityType === "ACCOUNT" && !l.sourceKey.startsWith("opening:"))
      .map((l) => [l.sourceKey, l.entityId]),
  ),
  categories: new Map(links.filter((l) => l.entityType === "CATEGORY").map((l) => [l.sourceKey, l.entityId])),
});
