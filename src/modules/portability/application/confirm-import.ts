import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, localDateIn, Money, ok, type DomainError, type Result } from "@/shared/kernel";
import { personNameOf } from "../domain/account-dispositions";
import {
  confirmBatch,
  draftSnapshot,
  IMPORT_GROUP_NAME,
  targetAccountOf,
  type CreatedEntities,
  type ImportBatch,
  type ImportCounts,
  type ImportMappings,
} from "../domain/import-batch";
import { openingKeyOf, planImport } from "../domain/import-plan";
import { checkMappings, importGroupOf, type HearthTargets } from "../domain/mapping-proposals";
import type { SourceAccount, SourceIssue, SourceMovement, SourceSnapshot } from "../domain/source-snapshot";
import { authorizeImporter, ownBatch, priorLinksFor } from "./import-access";
import type { ImportDeps, ImportLink, ImportWriter, MovementTime } from "./import-ports";
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
  /** P337: the importer's name and locale, for a Persona's new direct space (named and seeded as a split's). */
  readonly userName: string;
  readonly locale: string;
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
  /** P337: each Persona's direct space, by its source account. */
  readonly people: Map<string, string>;
}

/** What a confirm created and what it restored (design §3.3), which its undo archives again. */
interface Brought {
  readonly created: string[];
  readonly restored: string[];
}

/** P337: the source's accounts in its own order (a snapshot stored before P337 keeps its list order). */
const inSourceOrder = (accounts: readonly SourceAccount[]): SourceAccount[] =>
  accounts
    .map((account, index) => ({ account, rank: account.order ?? index }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ account }) => account);

/**
 * The accounts the import creates, in the source's order, with their opening balance (gap G1) and their settled
 * names, those it restores (archived by an undone import of this source) and those it maps to; all or nothing. P337:
 * a Persona gets no account. An Archivar's account the import creates, or restores for movements to record in it, is
 * listed in `toArchive` for the end of the confirm; one it merges into (the person's own) never is, and an archived
 * one no movement touches is left archived.
 */
const resolveAccounts = async (
  deps: Pick<ImportDeps, "writer">,
  input: { spaceId: string; userId: string },
  accountsInOrder: readonly SourceAccount[],
  mappings: ImportMappings,
  targets: HearthTargets,
  plan: { readonly openingBalances: ReadonlyMap<string, bigint>; readonly touched: ReadonlySet<string> },
  brought: Brought,
  toArchive: { sourceId: string; accountId: string }[],
): Promise<Result<Resolved["accounts"]>> => {
  const accounts: Resolved["accounts"] = new Map();
  for (const account of accountsInOrder) {
    const mapping = mappings.accounts[account.sourceId]!;
    if (mapping.kind === "person") continue;
    const archive = mapping.kind === "archive";
    const accountId = targetAccountOf(mapping);
    if (accountId !== null) {
      const target = targets.accounts.find((a) => a.id === accountId)!;
      if (target.archived && (!archive || plan.touched.has(account.sourceId))) {
        const restored = await deps.writer.restoreAccount({ ...input, accountId: target.id });
        if (!restored.ok) return about(account.sourceId, restored.error);
        brought.restored.push(target.id);
        if (archive) toArchive.push({ sourceId: account.sourceId, accountId: target.id });
      }
      accounts.set(account.sourceId, { id: target.id, currency: target.currency });
      continue;
    }
    if (mapping.kind === "existing") continue;
    const opening = Money.ofMinor(plan.openingBalances.get(account.sourceId) ?? 0n, mapping.currency);
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
    if (archive) toArchive.push({ sourceId: account.sourceId, accountId: id.value });
    accounts.set(account.sourceId, { id: id.value, currency: mapping.currency });
  }
  return ok(accounts);
};

/**
 * P337, P338: each Persona's direct space, in the source's order: the one an earlier import of this source opened
 * for it (standing or undone), else a new one with a guest under the Persona's name; all or nothing.
 */
const resolvePeople = async (
  deps: Pick<ImportDeps, "writer">,
  requester: { userId: string; userName: string; locale: string },
  accountsInOrder: readonly SourceAccount[],
  mappings: ImportMappings,
  linked: ReadonlyMap<string, string>,
  opened: string[],
): Promise<Result<Resolved["people"]>> => {
  const people: Resolved["people"] = new Map();
  for (const account of accountsInOrder) {
    const mapping = mappings.accounts[account.sourceId]!;
    if (mapping.kind !== "person") continue;
    const known = linked.get(account.sourceId);
    if (known !== undefined) {
      people.set(account.sourceId, known);
      continue;
    }
    const space = await deps.writer.openDirectSpaceWithGuest({
      ...requester,
      guestName: mapping.name ?? personNameOf(account.name),
    });
    if (!space.ok) return about(account.sourceId, space.error);
    opened.push(space.value.spaceId);
    people.set(account.sourceId, space.value.spaceId);
  }
  return ok(people);
};

type PersonSettlement = Parameters<ImportWriter["recordPersonSettlement"]>[0];

/** A movement's amount without its sign, for a settlement (always positive). */
const absolute = (amount: Money): Result<Money> =>
  Money.ofMinor(amount.minor < 0n ? -amount.minor : amount.minor, amount.currency.code);

/**
 * P337, P334: a movement that touches a Persona, as a settlement with that person by its effect on the source
 * account's balance (positive: the person owes the importer). Money into the Persona (a transfer from one of the
 * importer's accounts, an income, a positive adjustment) is TO them; money out of it (a transfer into an account, an
 * expense, a negative adjustment) is FROM them. Only a transfer has an account side; a transfer between two people is
 * refused (`TransferBetweenPeople`). Null for a movement no Persona has.
 */
const settlementOf = (
  movement: SourceMovement,
  resolved: Resolved,
  base: { userId: string; description?: string; time: MovementTime },
): Result<PersonSettlement> | null => {
  const from = resolved.people.get(movement.accountSourceId);
  const to =
    movement.kind === "TRANSFER" && movement.toAccountSourceId !== null
      ? resolved.people.get(movement.toAccountSourceId)
      : undefined;
  if (from === undefined && to === undefined) return null;
  if (from !== undefined && to !== undefined) return err(domainError("TransferBetweenPeople"));
  if (to !== undefined) {
    const account = resolved.accounts.get(movement.accountSourceId);
    if (account === undefined) return err(domainError("AccountNotFound"));
    const amount = movement.toAmount ?? movement.amount;
    return ok({ ...base, spaceId: to, direction: "TO", accountId: account.id, amount });
  }
  const spaceId = from!;
  if (movement.kind === "TRANSFER") {
    const account =
      movement.toAccountSourceId === null ? undefined : resolved.accounts.get(movement.toAccountSourceId);
    if (account === undefined) return err(domainError("AccountNotFound"));
    return ok({ ...base, spaceId, direction: "FROM", accountId: account.id, amount: movement.amount });
  }
  const amount = absolute(movement.amount);
  if (!amount.ok) return amount;
  const into = movement.kind === "INCOME" || (movement.kind === "ADJUSTMENT" && movement.amount.minor > 0n);
  return ok({ ...base, spaceId, direction: into ? "TO" : "FROM", accountId: null, amount: amount.value });
};

/** The source accounts each movement touches, as its source or its destination. */
const touchedBy = (movements: readonly SourceMovement[]): Set<string> =>
  new Set(
    movements.flatMap((m) => [
      m.accountSourceId,
      ...(m.toAccountSourceId === null ? [] : [m.toAccountSourceId]),
    ]),
  );

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
 *
 * P337: accounts are created in the source's order. A Persona's movements are settlements in its direct space
 * (`settlementOf`), opened with a guest on first use, each its own row as any other movement. An Archivar's account the
 * import created or restored is archived once every movement is in, its history kept.
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
        space.currency,
      );
      if (!mappings.ok) return mappings;
      const known = await knownFor(deps, space.spaceId, snapshot.value, mappings.value);
      if (!known.ok) return known;
      const plan = planImport(snapshot.value, mappings.value, known.value);

      const who = { spaceId: space.spaceId, userId: input.userId };
      const accountsBrought: Brought = { created: [], restored: [] };
      const categoriesBrought: Brought = { created: [], restored: [] };
      const toArchive: { sourceId: string; accountId: string }[] = [];
      const opened: string[] = [];
      const movements: string[] = [];
      const settlements: { spaceId: string; movementId: string }[] = [];
      const ordered = inSourceOrder(snapshot.value.accounts);
      const accounts = await resolveAccounts(
        deps,
        who,
        ordered,
        mappings.value,
        targets.value,
        { openingBalances: plan.openingBalances, touched: touchedBy(plan.toRecord) },
        accountsBrought,
        toArchive,
      );
      if (!accounts.ok) return accounts;
      // P337: a Persona keeps the direct space an earlier import of this source opened for it, standing or undone.
      const personLinks = new Map(
        [...(await deps.links.undoneLinksOf(space.spaceId, snapshot.value.sourceApp)), ...known.value.links]
          .filter((l) => l.entityType === "PERSON")
          .map((l) => [l.sourceKey, l.entityId] as const),
      );
      const people = await resolvePeople(
        deps,
        { userId: input.userId, userName: input.userName, locale: input.locale },
        ordered,
        mappings.value,
        personLinks,
        opened,
      );
      if (!people.ok) return people;
      const categories = await resolveCategories(
        deps,
        who,
        snapshot.value,
        mappings.value,
        targets.value,
        categoriesBrought,
      );
      if (!categories.ok) return categories;
      const resolved: Resolved = {
        accounts: accounts.value,
        categories: categories.value,
        people: people.value,
      };

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
        ...[...resolved.people].map(([sourceId, spaceId]) => link(sourceId, "PERSON", spaceId)),
        ...plan.folded.map((m) =>
          link(openingKeyOf(m.sourceKey), "ACCOUNT", resolved.accounts.get(m.accountSourceId)!.id),
        ),
      ];
      const rowErrors: SourceIssue[] = [];
      let adjustmentsRefused = 0;
      for (const movement of plan.toRecord) {
        const settlement = settlementOf(movement, resolved, {
          userId: input.userId,
          ...(movement.note === null ? {} : { description: movement.note }),
          time: timeOf(movement, mappings.value.timeZone),
        });
        const id =
          settlement === null
            ? await record(deps, space, input.userId, movement, resolved, mappings.value.timeZone)
            : settlement.ok
              ? await deps.writer.recordPersonSettlement(settlement.value)
              : settlement;
        if (!id.ok) {
          rowErrors.push(rowError(movement.sourceKey, id.error));
          if (movement.kind === "ADJUSTMENT") adjustmentsRefused += 1;
          continue;
        }
        if (settlement?.ok) settlements.push({ spaceId: settlement.value.spaceId, movementId: id.value });
        else movements.push(id.value);
        links.push(link(movement.sourceKey, "MOVEMENT", id.value));
      }
      // P337: an Archivar's account leaves the pickers and totals once its movements are in, its history kept.
      for (const { sourceId, accountId } of toArchive) {
        const archived = await deps.writer.archiveAccount({ ...who, accountId });
        if (!archived.ok) return about(sourceId, archived.error);
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
        peopleCreated: opened.length,
        accountsArchived: toArchive.length,
      };
      // What the undo reverts: every movement it recorded, and every account and category it created or restored.
      const created: CreatedEntities = {
        accounts: [...accountsBrought.created, ...accountsBrought.restored],
        categories: [...categoriesBrought.created, ...categoriesBrought.restored],
        movements,
        settlements,
        people: opened,
      };
      const outcome = { counts, rowErrors, created };
      const confirmed = confirmBatch(batch.value, outcome, deps.clock.now());
      if (!confirmed.ok) return confirmed;
      await deps.batches.save(confirmed.value);
      return ok(resultOf(confirmed.value));
    });
