import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, localDateIn, Money, ok, type DomainError, type Result } from "@/shared/kernel";
import {
  confirmBatch,
  draftSnapshot,
  IMPORT_GROUP_NAME,
  type CreatedEntities,
  type ImportBatch,
  type ImportCounts,
  type ImportMappings,
} from "../domain/import-batch";
import { openingKeyOf, planImport } from "../domain/import-plan";
import { checkMappings, importGroupOf, type HearthTargets } from "../domain/mapping-proposals";
import type { SourceIssue, SourceMovement, SourceSnapshot } from "../domain/source-snapshot";
import { authorizeImporter, ownBatch, priorLinksFor } from "./import-access";
import type { ImportDeps, ImportLink, MovementTime } from "./import-ports";
import { knownFor } from "./import-view";

/** What a confirm or an undo answers, and the history lists (design §3.2). */
export interface ImportResult {
  readonly id: string;
  readonly status: ImportBatch["status"];
  readonly counts: ImportCounts | null;
  readonly rowErrors: readonly SourceIssue[];
}

export const resultOf = (batch: ImportBatch): ImportResult => ({
  id: batch.id,
  status: batch.status,
  counts: batch.counts,
  rowErrors: batch.rowErrors,
});

export type ConfirmImport = (input: {
  readonly spaceId: string;
  readonly userId: string;
  readonly importId: string;
}) => Promise<Result<ImportResult>>;

/** A row's issue from the ledger's refusal, in the snapshot's own shape (design §3.2). */
const rowError = (sourceKey: string, error: DomainError): SourceIssue => ({
  code: error.code,
  sourceKey,
  ...(error.details === undefined
    ? {}
    : { details: Object.fromEntries(Object.entries(error.details).map(([k, v]) => [k, String(v)])) }),
});

/**
 * A refusal of an account or category that stops the whole confirm, naming the source record it is about and the
 * module's own code (`ImportTargetRefused`, design §3.2). Names never cause one: `checkMappings` settled them.
 */
const about = (sourceId: string, error: DomainError) =>
  err(domainError("ImportTargetRefused", { sourceId, reason: error.code }));

/**
 * HU-E4-14, design §2.3: a movement keeps its date, and its instant in the chosen zone when that instant falls on that
 * date there; otherwise (or without an instant) it is recorded with its date alone.
 */
const timeOf = (movement: SourceMovement, timeZone: string): MovementTime =>
  movement.occurredAt !== null && localDateIn(movement.occurredAt, timeZone) === movement.date
    ? { date: movement.date, occurredAt: movement.occurredAt, timeZone }
    : { date: movement.date, untimed: true };

/**
 * D29 section 4.2, as MC3 records it: `amount` is what was entered and `convertedAmount` the base amount when they
 * differ. In an account of the base currency, the source's original (if any) is what was entered and its account
 * amount the base. In an account of another currency, the account amount is entered (its leg stays exact), and an
 * original in the base currency is the base; otherwise the base follows the date's rate (ExchangeRateRequired when
 * none), and an original in a third currency is not kept.
 */
const amountsOf = (movement: SourceMovement, accountCurrency: string, base: string) => {
  const original = movement.originalAmount;
  if (accountCurrency === base) {
    return original === null
      ? { amount: movement.amount }
      : { amount: original, convertedAmount: movement.amount };
  }
  return original !== null && original.currency.code === base
    ? { amount: movement.amount, convertedAmount: original }
    : { amount: movement.amount };
};

interface Resolved {
  readonly accounts: Map<string, { readonly id: string; readonly currency: string }>;
  readonly categories: Map<string, string>;
}

/** What a confirm created and what it restored (design §3.3), which its undo archives again. */
interface Brought {
  readonly created: string[];
  readonly restored: string[];
}

/**
 * The accounts the import creates, with their opening balance (gap G1) and their settled names, those it restores
 * (archived by an undone import of this source) and those it maps to; all or nothing.
 */
const resolveAccounts = async (
  deps: Pick<ImportDeps, "writer">,
  input: { spaceId: string; userId: string },
  snapshot: SourceSnapshot,
  mappings: ImportMappings,
  targets: HearthTargets,
  openingBalances: ReadonlyMap<string, bigint>,
  brought: Brought,
): Promise<Result<Resolved["accounts"]>> => {
  const accounts: Resolved["accounts"] = new Map();
  for (const account of snapshot.accounts) {
    const mapping = mappings.accounts[account.sourceId]!;
    if (mapping.kind === "existing") {
      const target = targets.accounts.find((a) => a.id === mapping.accountId)!;
      if (target.archived) {
        const restored = await deps.writer.restoreAccount({ ...input, accountId: target.id });
        if (!restored.ok) return about(account.sourceId, restored.error);
        brought.restored.push(target.id);
      }
      accounts.set(account.sourceId, { id: target.id, currency: target.currency });
      continue;
    }
    const opening = Money.ofMinor(openingBalances.get(account.sourceId) ?? 0n, mapping.currency);
    if (!opening.ok) return about(account.sourceId, opening.error);
    const id = await deps.writer.createAccount({
      ...input,
      name: mapping.name ?? account.name,
      type: mapping.type,
      openingBalance: opening.value,
      cutOffDay: account.cutOffDay,
      paymentDay: account.paymentDay,
    });
    if (!id.ok) return about(account.sourceId, id.error);
    brought.created.push(id.value);
    accounts.set(account.sourceId, { id: id.value, currency: mapping.currency });
  }
  return ok(accounts);
};

/**
 * The categories the import creates (under their settled names), restores and maps to (design §2.2), parents first;
 * all or nothing. A new top-level category with no group goes in the import's own group, found or created once. A
 * subcategory whose parent maps to a subcategory merges into that one, since Hearth has three levels (D20).
 */
const resolveCategories = async (
  deps: Pick<ImportDeps, "writer">,
  input: { spaceId: string; userId: string },
  snapshot: SourceSnapshot,
  mappings: ImportMappings,
  targets: HearthTargets,
  brought: Brought,
): Promise<Result<Resolved["categories"]>> => {
  const categories = new Map<string, string>();
  const isSubcategory = new Map(targets.categories.map((c) => [c.id, c.parentCategoryId !== null]));
  let importGroup = importGroupOf(targets.groups)?.id;
  const ordered = [
    ...snapshot.categories.filter((c) => c.parentSourceId === null),
    ...snapshot.categories.filter((c) => c.parentSourceId !== null),
  ];
  for (const category of ordered) {
    const mapping = mappings.categories[category.sourceId]!;
    if (mapping.kind === "existing") {
      const target = targets.categories.find((c) => c.id === mapping.categoryId)!;
      if (target.archived) {
        const restored = await deps.writer.restoreCategory({ ...input, categoryId: target.id });
        if (!restored.ok) return about(category.sourceId, restored.error);
        brought.restored.push(target.id);
      }
      categories.set(category.sourceId, target.id);
      continue;
    }
    let placement: { groupId: string } | { parentCategoryId: string };
    if (category.parentSourceId === null) {
      if (mapping.groupId === null && importGroup === undefined) {
        const group = await deps.writer.createCategoryGroup({ ...input, name: IMPORT_GROUP_NAME });
        if (!group.ok) return about(category.sourceId, group.error);
        importGroup = group.value;
      }
      placement = { groupId: mapping.groupId ?? importGroup! };
    } else {
      const parentId = categories.get(category.parentSourceId);
      if (parentId === undefined) return about(category.sourceId, domainError("CategoryNotFound"));
      if (isSubcategory.get(parentId) === true) {
        categories.set(category.sourceId, parentId);
        continue;
      }
      placement = { parentCategoryId: parentId };
    }
    const id = await deps.writer.createCategory({
      ...input,
      ...placement,
      name: mapping.name ?? category.name,
      emoji: "groupId" in placement ? category.icon : null,
    });
    if (!id.ok) return about(category.sourceId, id.error);
    brought.created.push(id.value);
    isSubcategory.set(id.value, "parentCategoryId" in placement);
    categories.set(category.sourceId, id.value);
  }
  return ok(categories);
};

/** One movement through the ledger's own use case; its refusal is that row's error, never the batch's. */
const record = async (
  deps: Pick<ImportDeps, "writer">,
  space: SpaceMembership,
  userId: string,
  movement: SourceMovement,
  resolved: Resolved,
  timeZone: string,
): Promise<Result<string>> => {
  const account = resolved.accounts.get(movement.accountSourceId);
  if (account === undefined) return err(domainError("AccountNotFound"));
  const base = {
    spaceId: space.spaceId,
    userId,
    ...(movement.note === null ? {} : { description: movement.note }),
    time: timeOf(movement, timeZone),
  };
  // Design Q4 (#329): a balance adjustment the opening balance did not take, signed, in its account's own currency.
  if (movement.kind === "ADJUSTMENT") {
    return deps.writer.recordAdjustment({ ...base, accountId: account.id, amount: movement.amount });
  }
  if (movement.kind === "TRANSFER") {
    const destination =
      movement.toAccountSourceId === null ? undefined : resolved.accounts.get(movement.toAccountSourceId);
    if (destination === undefined) return err(domainError("AccountNotFound"));
    return deps.writer.recordTransfer({
      ...base,
      sourceAccountId: account.id,
      destinationAccountId: destination.id,
      amount: movement.amount,
      ...(movement.toAmount !== null && destination.currency !== account.currency
        ? { destinationAmount: movement.toAmount }
        : {}),
    });
  }
  const categoryId =
    movement.categorySourceId === null ? undefined : resolved.categories.get(movement.categorySourceId);
  if (categoryId === undefined) return err(domainError("CategoryRequired"));
  const write = {
    ...base,
    categoryId,
    accountId: account.id,
    ...amountsOf(movement, account.currency, space.currency),
  };
  return movement.kind === "EXPENSE" ? deps.writer.recordExpense(write) : deps.writer.recordIncome(write);
};

/**
 * Design §3.2, §3.3: commits a draft in one database transaction under the space lock (#89). It creates the new
 * accounts and categories, records every movement through the ledger's use cases, so an import stores only what a
 * person could record, writes the links, and answers the counts. A movement already linked is skipped; a movement the
 * ledger refuses (no rate for its date, a closed period) is a row error and the rest still imports; a refused account or
 * category stops everything (`ImportTargetRefused`, naming it), since its movements could not go anywhere. Accounts and
 * categories an undone import of this source created are restored rather than created again (design §3.3).
 */
export const createConfirmImport =
  (deps: ImportDeps): ConfirmImport =>
  (input) =>
    deps.tm.run(async () => {
      await deps.spaceLocks.lockForMoneyWrite(input.spaceId);
      const importer = await authorizeImporter(deps, input.spaceId, input.userId);
      if (!importer.ok) return importer;
      const space = importer.value;
      // The batch row is locked: a second confirm of it waits here, then finds it CONFIRMED (ImportNotDraft).
      const batch = ownBatch(await deps.batches.findForUpdate(space.spaceId, input.importId), input.userId);
      if (!batch.ok) return batch;
      const snapshot = draftSnapshot(batch.value);
      if (!snapshot.ok) return snapshot;
      const targets = await deps.writer.targetsOf(space.spaceId, input.userId);
      if (!targets.ok) return targets;
      const mappings = checkMappings(
        snapshot.value,
        batch.value.mappings,
        targets.value,
        await priorLinksFor(deps, space.spaceId, snapshot.value.sourceApp),
      );
      if (!mappings.ok) return mappings;
      const known = await knownFor(deps, space.spaceId, snapshot.value, mappings.value);
      if (!known.ok) return known;
      const plan = planImport(snapshot.value, mappings.value, known.value);

      const who = { spaceId: space.spaceId, userId: input.userId };
      const accountsBrought: Brought = { created: [], restored: [] };
      const categoriesBrought: Brought = { created: [], restored: [] };
      const movements: string[] = [];
      const accounts = await resolveAccounts(
        deps,
        who,
        snapshot.value,
        mappings.value,
        targets.value,
        plan.openingBalances,
        accountsBrought,
      );
      if (!accounts.ok) return accounts;
      const categories = await resolveCategories(
        deps,
        who,
        snapshot.value,
        mappings.value,
        targets.value,
        categoriesBrought,
      );
      if (!categories.ok) return categories;
      const resolved: Resolved = { accounts: accounts.value, categories: categories.value };

      const { sourceApp } = snapshot.value;
      const link = (
        sourceKey: string,
        entityType: ImportLink["entityType"],
        entityId: string,
      ): ImportLink => ({
        spaceId: space.spaceId,
        sourceApp,
        sourceKey,
        entityType,
        entityId,
        importId: batch.value.id,
      });
      const links: ImportLink[] = [
        ...[...resolved.accounts].map(([sourceId, a]) => link(sourceId, "ACCOUNT", a.id)),
        ...[...resolved.categories].map(([sourceId, id]) => link(sourceId, "CATEGORY", id)),
        ...plan.folded.map((m) =>
          link(openingKeyOf(m.sourceKey), "ACCOUNT", resolved.accounts.get(m.accountSourceId)!.id),
        ),
      ];
      const rowErrors: SourceIssue[] = [];
      let adjustmentsRefused = 0;
      for (const movement of plan.toRecord) {
        const id = await record(deps, space, input.userId, movement, resolved, mappings.value.timeZone);
        if (!id.ok) {
          rowErrors.push(rowError(movement.sourceKey, id.error));
          if (movement.kind === "ADJUSTMENT") adjustmentsRefused += 1;
          continue;
        }
        movements.push(id.value);
        links.push(link(movement.sourceKey, "MOVEMENT", id.value));
      }

      // Design §2.2: a deleted source category still used by a movement is imported, then archived; only one the
      // import created or restored, never a category of the person's.
      const ours = new Set([...categoriesBrought.created, ...categoriesBrought.restored]);
      for (const category of snapshot.value.categories.filter((c) => c.deleted)) {
        const id = resolved.categories.get(category.sourceId);
        if (id === undefined || !ours.has(id)) continue;
        const archived = await deps.writer.archiveCategory({ ...who, categoryId: id });
        if (!archived.ok) return about(category.sourceId, archived.error);
      }
      await deps.links.upsert(links);

      const counts: ImportCounts = {
        accountsCreated: accountsBrought.created.length,
        accountsRestored: accountsBrought.restored.length,
        categoriesCreated: categoriesBrought.created.length,
        categoriesRestored: categoriesBrought.restored.length,
        movementsImported: movements.length,
        alreadyImported: plan.alreadyImported.length,
        duplicatesSkipped: plan.duplicatesSkipped.length,
        adjustmentsInOpeningBalance: plan.folded.length,
        // Design Q4 (#329): the adjustments the ledger refused (each a row error too); every other one was imported.
        adjustmentsNotImported: adjustmentsRefused,
        rowErrors: rowErrors.length,
      };
      // What the undo reverts: every movement it recorded, and every account and category it created or restored.
      const created: CreatedEntities = {
        accounts: [...accountsBrought.created, ...accountsBrought.restored],
        categories: [...categoriesBrought.created, ...categoriesBrought.restored],
        movements,
      };
      const outcome = { counts, rowErrors, created };
      const confirmed = confirmBatch(batch.value, outcome, deps.clock.now());
      if (!confirmed.ok) return confirmed;
      await deps.batches.save(confirmed.value);
      return ok(resultOf(confirmed.value));
    });
