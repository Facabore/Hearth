import { isErr, ok, type Money, type Result } from "@/shared/kernel";
import type {
  AccountMapping,
  CategoryMapping,
  ImportBatch,
  ImportMappings,
  ImportStatus,
} from "../domain/import-batch";
import { planImport } from "../domain/import-plan";
import { previewImport, type ExistingMovement, type ImportPreview } from "../domain/import-planner";
import type { SourceAccountType, SourceIssue, SourceSnapshot } from "../domain/source-snapshot";
import type { ImportDeps, ImportLink } from "./import-ports";

/** What earlier imports and Hearth already hold, as the planner reads it (design §3.1, §3.3). */
export interface Known {
  readonly links: readonly ImportLink[];
  readonly linkedKeys: ReadonlySet<string>;
  readonly duplicateKeys: ReadonlySet<string>;
  readonly preview: ImportPreview;
}

/**
 * Design §3.3: a movement is linked by its own key, a folded adjustment by its opening key; account and category links
 * are keyed by the source's account and category ids and never make a movement "already imported".
 */
const linkedKeysOf = (links: readonly ImportLink[]): Set<string> =>
  new Set(
    links
      .filter(
        (l) =>
          l.entityType === "MOVEMENT" || (l.entityType === "ACCOUNT" && l.sourceKey.startsWith("opening:")),
      )
      .map((l) => l.sourceKey),
  );

/**
 * The links, the preview, and the likely duplicates: movements already in Hearth on the accounts the source accounts
 * map to, with the same date, amount and kind (design §3.1), less what an earlier import linked.
 */
export const knownFor = async (
  deps: Pick<ImportDeps, "links" | "writer">,
  spaceId: string,
  snapshot: SourceSnapshot,
  mappings: ImportMappings,
): Promise<Result<Known>> => {
  const links = await deps.links.linksOf(spaceId, snapshot.sourceApp);
  const linkedKeys = linkedKeysOf(links);
  const sourcesOf = new Map<string, string[]>();
  for (const [sourceId, mapping] of Object.entries(mappings.accounts)) {
    if (mapping.kind !== "existing") continue;
    sourcesOf.set(mapping.accountId, [...(sourcesOf.get(mapping.accountId) ?? []), sourceId]);
  }
  const dates = snapshot.movements.map((m) => m.date).sort();
  const hearth =
    sourcesOf.size === 0 || dates.length === 0
      ? []
      : await deps.writer.movementsOf(spaceId, [...sourcesOf.keys()], dates[0]!, dates.at(-1)!);
  const existing: ExistingMovement[] = hearth.flatMap((movement) =>
    (sourcesOf.get(movement.accountId) ?? []).map((accountSourceId) => ({
      accountSourceId,
      date: movement.date,
      amountMinor: movement.amountMinor,
      kind: movement.kind,
      ...(movement.incoming === true ? { incoming: true as const } : {}),
    })),
  );
  const preview = previewImport(snapshot, { timeZone: mappings.timeZone, existing });
  if (isErr(preview)) return preview;
  const duplicateKeys = new Set(
    preview.value.duplicates.map((d) => d.sourceKey).filter((key) => !linkedKeys.has(key)),
  );
  return ok({ links, linkedKeys, duplicateKeys, preview: preview.value });
};

export interface ImportAccountView {
  readonly sourceId: string;
  readonly name: string;
  readonly type: SourceAccountType;
  readonly currency: string;
  readonly cutOffDay: number | null;
  readonly paymentDay: number | null;
  readonly sourceClosingBalance: Money;
  readonly mapping: AccountMapping;
}

export interface ImportCategoryView {
  readonly sourceId: string;
  readonly name: string;
  readonly icon: string | null;
  readonly kind: "INCOME" | "EXPENSE";
  readonly parentSourceId: string | null;
  /** A deleted source category still used by a movement: imported, then archived (design §2.2). */
  readonly archived: boolean;
  /** The catalog category (P330) its name matched, whether or not the space has it; null otherwise. */
  readonly catalogKey: string | null;
  readonly mapping: CategoryMapping;
}

/** An upload's preview, the dry run of design §3.2, with the mappings a confirm would use. */
export interface ImportView {
  readonly id: string;
  readonly status: ImportStatus;
  readonly sourceApp: string;
  readonly createdAt: Date;
  /** Design §3.3: when a confirmed import of the same file (same hash) last ran here; null for a new file. */
  readonly previouslyImportedAt: Date | null;
  readonly timeZone: string;
  readonly counts: ImportPreview["counts"];
  readonly dateRange: ImportPreview["dateRange"];
  readonly accounts: readonly ImportAccountView[];
  readonly categories: readonly ImportCategoryView[];
  /** Likely duplicates of movements already in Hearth; skipped unless listed in `includeDuplicates`. */
  readonly duplicates: readonly string[];
  readonly includeDuplicates: readonly string[];
  /** What a confirm now would write and skip. */
  readonly plan: {
    readonly movements: number;
    readonly alreadyImported: readonly string[];
    readonly duplicatesSkipped: number;
    readonly adjustmentsInOpeningBalance: number;
    readonly adjustmentsNotImported: number;
  };
  readonly leftOut: ImportPreview["leftOut"];
  readonly warnings: readonly SourceIssue[];
  readonly errors: readonly SourceIssue[];
}

/** The view of a draft: its preview with the batch's own mappings over the planner's first proposal. */
export const viewOf = async (
  deps: Pick<ImportDeps, "links" | "writer" | "batches">,
  batch: ImportBatch,
  snapshot: SourceSnapshot,
): Promise<Result<ImportView>> => {
  const known = await knownFor(deps, batch.spaceId, snapshot, batch.mappings);
  if (isErr(known)) return known;
  const { preview } = known.value;
  const plan = planImport(snapshot, batch.mappings, known.value);
  const byId = new Map(snapshot.accounts.map((a) => [a.sourceId, a]));
  return ok({
    id: batch.id,
    status: batch.status,
    sourceApp: batch.sourceApp,
    createdAt: batch.createdAt,
    previouslyImportedAt: await deps.batches.lastConfirmedWithHash(batch.spaceId, batch.fileSha256, batch.id),
    timeZone: batch.mappings.timeZone,
    counts: preview.counts,
    dateRange: preview.dateRange,
    accounts: preview.accounts.map((account) => ({
      sourceId: account.sourceId,
      name: account.name,
      type: account.mapping.type,
      currency: byId.get(account.sourceId)!.currency,
      cutOffDay: account.cutOffDay,
      paymentDay: account.paymentDay,
      sourceClosingBalance: account.sourceClosingBalance,
      mapping: batch.mappings.accounts[account.sourceId] ?? account.mapping,
    })),
    categories: preview.categories.map((category) => ({
      sourceId: category.sourceId,
      name: category.name,
      icon: category.icon,
      kind: category.kind,
      parentSourceId: category.parentSourceId,
      archived: category.archived,
      catalogKey: category.proposal.kind === "catalog" ? category.proposal.catalogKey : null,
      mapping: batch.mappings.categories[category.sourceId] ?? { kind: "new", groupId: null },
    })),
    duplicates: [...known.value.duplicateKeys],
    includeDuplicates: batch.mappings.includeDuplicates,
    plan: {
      movements: plan.toRecord.length,
      alreadyImported: plan.alreadyImported,
      duplicatesSkipped: plan.duplicatesSkipped.length,
      adjustmentsInOpeningBalance: plan.folded.length,
      adjustmentsNotImported: plan.adjustmentsNotImported.length,
    },
    leftOut: preview.leftOut,
    warnings: preview.warnings,
    errors: preview.errors,
  });
};
