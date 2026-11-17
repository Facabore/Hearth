import { isErr, ok, type Money, type Result } from "@/shared/kernel";
import type { AccountDisposition } from "../domain/account-dispositions";
import { existingTargetsOf, planCategoryGroups, unusedSeeded } from "../domain/category-groups";
import {
  targetAccountOf,
  type AccountMapping,
  type ImportBatch,
  type ImportMappings,
  type ImportStatus,
} from "../domain/import-batch";
import { planImport } from "../domain/import-plan";
import { previewImport, type ExistingMovement, type ImportPreview } from "../domain/import-planner";
import {
  accountOptionsOf,
  categoryLinksOf,
  type AccountOptions,
  type HearthTargets,
  type PriorLinks,
} from "../domain/mapping-proposals";
import type { SourceAccountType, SourceIssue, SourceSnapshot } from "../domain/source-snapshot";
import type { ImportDeps, ImportLink } from "./import-ports";

/** What earlier imports and Hearth already hold, as the planner reads it (design §3.1, §3.3). */
export interface Known {
  readonly links: readonly ImportLink[];
  readonly linkedKeys: ReadonlySet<string>;
  /** Each adjustment an undone import folded into an opening balance, by its opening key, and that account. */
  readonly undoneOpenings: ReadonlyMap<string, string>;
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
  const undoneOpenings = new Map(
    (await deps.links.undoneLinksOf(spaceId, snapshot.sourceApp))
      .filter((l) => l.entityType === "ACCOUNT" && l.sourceKey.startsWith("opening:"))
      .map((l) => [l.sourceKey, l.entityId] as const),
  );
  const sourcesOf = new Map<string, string[]>();
  for (const [sourceId, mapping] of Object.entries(mappings.accounts)) {
    const accountId = targetAccountOf(mapping);
    if (accountId === null) continue;
    sourcesOf.set(accountId, [...(sourcesOf.get(accountId) ?? []), sourceId]);
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
  return ok({ links, linkedKeys, undoneOpenings, duplicateKeys, preview: preview.value });
};

export interface ImportAccountView {
  readonly sourceId: string;
  readonly name: string;
  readonly type: SourceAccountType;
  readonly currency: string;
  readonly cutOffDay: number | null;
  readonly paymentDay: number | null;
  readonly sourceClosingBalance: Money;
  /** Money Manager's hidden flag (P337: it suggests Archivar). */
  readonly hidden: boolean;
  /** P337: the snapshot's movements that touch it, as source or destination. */
  readonly movementCount: number;
  /** P337: what Hearth preselected (Cuenta, Persona or Archivar); it stays as the person changes the mapping. */
  readonly suggested: AccountDisposition;
  /** P337: the mapping each disposition stands for, ready to send back as it is. */
  readonly options: AccountOptions["options"];
  /** P337: the person's account this starter account duplicates ("Cash" beside "Efectivo"), if any. */
  readonly duplicateOf: { readonly id: string; readonly name: string } | null;
  readonly mapping: AccountMapping;
}

/** P337: a source category as the confirm will land it, in a group of its own name or one the space holds. */
export interface ImportCategoryView {
  readonly sourceId: string;
  readonly name: string;
  readonly icon: string | null;
  /** "existing" when it lands on a category the space holds (restored when archived). */
  readonly target: "new" | "existing";
}

/** P337: a top-level Money Manager category as the group it becomes, with its categories in the source's order. */
export interface ImportCategoryGroupView {
  readonly name: string;
  readonly icon: string | null;
  /** "existing" when a group of the same name (or one an earlier import made) takes it, restored when archived. */
  readonly target: "new" | "existing";
  readonly categories: readonly ImportCategoryView[];
}

/** P337, board 4 "Tus categorías": the person's categories as they had them, and what "Archivar…" would archive. */
export interface ImportCategoriesView {
  readonly groups: readonly ImportCategoryGroupView[];
  readonly archiveUnusedCategories: boolean;
  /** The seeded groups and categories no movement uses, the import's included: what the switch archives. */
  readonly unusedSeeded: {
    readonly groups: readonly { readonly id: string; readonly name: string }[];
    readonly categories: readonly { readonly id: string; readonly name: string }[];
  };
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
  /** In the source's own order (P337). */
  readonly accounts: readonly ImportAccountView[];
  readonly categories: ImportCategoriesView;
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

/** What Hearth holds that the view's account options read (P337). */
export interface ViewContext {
  readonly targets: HearthTargets;
  readonly links: PriorLinks;
  readonly spaceCurrency: string;
}

/** The view of a draft: its preview with the batch's own mappings over the planner's first proposal. */
export const viewOf = async (
  deps: Pick<ImportDeps, "links" | "writer" | "batches">,
  batch: ImportBatch,
  snapshot: SourceSnapshot,
  context: ViewContext,
): Promise<Result<ImportView>> => {
  const known = await knownFor(deps, batch.spaceId, snapshot, batch.mappings);
  if (isErr(known)) return known;
  const { preview } = known.value;
  const plan = planImport(snapshot, batch.mappings, known.value);
  const byId = new Map(snapshot.accounts.map((a, index) => [a.sourceId, { ...a, index }]));
  const options = accountOptionsOf(snapshot, context.targets, context.links, context.spaceCurrency);
  // A snapshot stored before P337 has no order: the source's own list order stands in for it.
  const rank = (sourceId: string) => byId.get(sourceId)?.order ?? byId.get(sourceId)?.index ?? 0;
  const { targets } = context;
  const groups = planCategoryGroups(snapshot, targets, categoryLinksOf(context.links));
  const unused = unusedSeeded(
    targets,
    await deps.writer.usedCategoryIds(batch.spaceId),
    existingTargetsOf(groups),
  );
  const nameOf = (records: readonly { readonly id: string; readonly name: string }[]) => (id: string) => ({
    id,
    name: records.find((r) => r.id === id)?.name ?? "",
  });
  return ok({
    id: batch.id,
    status: batch.status,
    sourceApp: batch.sourceApp,
    createdAt: batch.createdAt,
    previouslyImportedAt: await deps.batches.lastConfirmedWithHash(batch.spaceId, batch.fileSha256, batch.id),
    timeZone: batch.mappings.timeZone,
    counts: preview.counts,
    dateRange: preview.dateRange,
    accounts: [...preview.accounts]
      .sort((a, b) => rank(a.sourceId) - rank(b.sourceId))
      .map((account) => {
        const proposal = options.get(account.sourceId)!;
        return {
          sourceId: account.sourceId,
          name: account.name,
          type: account.mapping.type,
          currency: byId.get(account.sourceId)!.currency,
          cutOffDay: account.cutOffDay,
          paymentDay: account.paymentDay,
          sourceClosingBalance: account.sourceClosingBalance,
          hidden: byId.get(account.sourceId)!.hidden,
          movementCount: proposal.movementCount,
          suggested: proposal.suggested,
          options: proposal.options,
          duplicateOf:
            proposal.duplicateOf === null
              ? null
              : { id: proposal.duplicateOf.id, name: proposal.duplicateOf.name },
          mapping: batch.mappings.accounts[account.sourceId] ?? account.mapping,
        };
      }),
    categories: {
      groups: groups.map((group) => ({
        name: group.name,
        icon: group.icon,
        target: group.target.kind,
        categories: group.categories.map((category) => ({
          sourceId: category.sourceId,
          name: category.name,
          icon: category.icon,
          target: category.target.kind,
        })),
      })),
      archiveUnusedCategories: batch.mappings.archiveUnusedCategories,
      unusedSeeded: {
        groups: unused.groups.map(nameOf(targets.groups)),
        categories: unused.categories.map(nameOf(targets.categories)),
      },
    },
    duplicates: [...known.value.duplicateKeys],
    includeDuplicates: batch.mappings.includeDuplicates,
    plan: {
      movements: plan.toRecord.length,
      alreadyImported: plan.alreadyImported,
      duplicatesSkipped: plan.duplicatesSkipped.length,
      adjustmentsInOpeningBalance: plan.folded.length,
      // Design Q4 (#329): every adjustment is now imported, folded or as a movement; only a refused one is not.
      adjustmentsNotImported: 0,
    },
    leftOut: preview.leftOut,
    warnings: preview.warnings,
    errors: preview.errors,
  });
};
