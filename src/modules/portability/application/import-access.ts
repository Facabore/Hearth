import { authorizeSpaceAction, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { ImportBatch } from "../domain/import-batch";
import type { PriorLinks } from "../domain/mapping-proposals";
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

const byType = (links: readonly ImportLink[], type: "ACCOUNT" | "CATEGORY") =>
  new Map(
    links
      .filter((l) => l.entityType === type && !l.sourceKey.startsWith("opening:"))
      .map((l) => [l.sourceKey, l.entityId]),
  );

/**
 * Design §3.3: what earlier imports of this source linked each source account and category to, those that stand and
 * those that were undone apart (folded adjustments left out).
 */
export const priorLinksFor = async (
  deps: Pick<ImportDeps, "links">,
  spaceId: string,
  sourceApp: string,
): Promise<PriorLinks> => {
  const live = await deps.links.linksOf(spaceId, sourceApp);
  const undone = await deps.links.undoneLinksOf(spaceId, sourceApp);
  return {
    accounts: byType(live, "ACCOUNT"),
    categories: byType(live, "CATEGORY"),
    undoneAccounts: byType(undone, "ACCOUNT"),
    undoneCategories: byType(undone, "CATEGORY"),
  };
};
