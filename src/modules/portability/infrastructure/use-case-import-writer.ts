import type {
  AccountRepository,
  ArchiveAccount,
  CreateAccount,
  RestoreAccount,
} from "@/modules/accounts/application";
import type {
  ArchiveCategory,
  ArchiveCategoryGroup,
  CategoryRepository,
  CategoryUsageCounts,
  CreateCategory,
  CreateCategoryGroup,
  RestoreCategory,
  RestoreCategoryGroup,
} from "@/modules/categories/application";
import {
  positionOf,
  type RecordPairSettlement,
  type DeleteTransaction,
  type RecordExpense,
  type RecordIncome,
  type RecordAdjustment,
  type RecordTransfer,
  type Transaction,
  type TransactionPosition,
  type TransactionQuery,
} from "@/modules/ledger/application";
import type { StartDirectSpaceWithGuest } from "@/modules/spaces/application";
import { fromParts, map, ok, type LocalDate, type Result } from "@/shared/kernel";
import type { HearthMovement, ImportWriter, MovementTime } from "../application";

/** Every date a movement can have: the import's usage check reads the whole history (D8). */
const ALL_DATES = { from: fromParts(1900, 1, 1), to: fromParts(9999, 12, 31) };
const MOVEMENT_PAGE = 500;

/** HU-E4-14: an imported movement's time as the ledger's create inputs take it. */
const importedWhen = (time: MovementTime) =>
  "untimed" in time
    ? { date: time.date, untimed: true as const }
    : { date: time.date, occurredAt: time.occurredAt, timeZone: time.timeZone };

/**
 * How `tx` moved `accountId`, in the account's own currency (D29), for duplicate detection (design §3.1): what it paid
 * (an expense), received (an income), sent (a transfer out) or got (a transfer in). Null when it did not touch it.
 */
export const movementOnAccount = (tx: Transaction, accountId: string): HearthMovement | null => {
  const at = { accountId, date: tx.date };
  if (tx.type === "EXPENSE") {
    const payment = tx.payments.find((p) => p.accountId === accountId);
    return payment === undefined
      ? null
      : { ...at, amountMinor: payment.accountAmount ?? payment.amount, kind: "EXPENSE" };
  }
  if (tx.type === "INCOME" && tx.destinationAccountId === accountId) {
    return { ...at, amountMinor: tx.destinationAmount ?? tx.amount, kind: "INCOME" };
  }
  if (tx.type === "TRANSFER" && tx.sourceAccountId === accountId) {
    return { ...at, amountMinor: tx.sourceAmount ?? tx.amount, kind: "TRANSFER" };
  }
  if (tx.type === "TRANSFER" && tx.destinationAccountId === accountId) {
    return { ...at, amountMinor: tx.destinationAmount ?? tx.amount, kind: "TRANSFER", incoming: true };
  }
  // Design Q4: a balance adjustment, signed as the source's own are (money in positive, out negative).
  if (tx.type === "ADJUSTMENT" && tx.destinationAccountId === accountId) {
    return { ...at, amountMinor: tx.destinationAmount ?? tx.amount, kind: "ADJUSTMENT" };
  }
  if (tx.type === "ADJUSTMENT" && tx.sourceAccountId === accountId) {
    return { ...at, amountMinor: -(tx.sourceAmount ?? tx.amount), kind: "ADJUSTMENT" };
  }
  return null;
};

export interface UseCaseImportWriterSources {
  readonly accounts: Pick<AccountRepository, "listBySpace">;
  readonly categories: Pick<CategoryRepository, "listGroups" | "listCategories">;
  readonly ledgerQueries: Pick<TransactionQuery, "list">;
  readonly usageCounts: CategoryUsageCounts;
  readonly createAccount: CreateAccount;
  readonly archiveAccount: ArchiveAccount;
  readonly restoreAccount: RestoreAccount;
  readonly createCategoryGroup: CreateCategoryGroup;
  readonly archiveCategoryGroup: ArchiveCategoryGroup;
  readonly restoreCategoryGroup: RestoreCategoryGroup;
  readonly createCategory: CreateCategory;
  readonly archiveCategory: ArchiveCategory;
  readonly restoreCategory: RestoreCategory;
  readonly recordExpense: RecordExpense;
  readonly recordIncome: RecordIncome;
  readonly recordTransfer: RecordTransfer;
  readonly recordAdjustment: RecordAdjustment;
  readonly deleteTransaction: DeleteTransaction;
  /** P337, P338: a Persona's direct space with its new guest. */
  readonly startDirectSpaceWithGuest: StartDirectSpaceWithGuest;
  /** P334, P337: a Persona's movements, as settlements in that space. */
  readonly recordPairSettlement: RecordPairSettlement;
}

/**
 * D28, design §3.1: the import's `ImportWriter`, over the accounts, categories and ledger use cases, which authorize
 * and lock every write again; the reads are the repositories' own (the import's use case authorized the caller).
 */
export const createUseCaseImportWriter = (sources: UseCaseImportWriterSources): ImportWriter => {
  const liveMovements = async (spaceId: string, accountId: string, from: LocalDate, to: LocalDate) => {
    const found: Transaction[] = [];
    let after: TransactionPosition | null = null;
    for (;;) {
      const page = await sources.ledgerQueries.list({ spaceId, from, to, accountId }, after, MOVEMENT_PAGE);
      found.push(...page);
      if (page.length < MOVEMENT_PAGE) return found;
      after = positionOf(page.at(-1)!);
    }
  };
  const idOf = <T extends { readonly id: string }>(result: Result<T>): Result<string> =>
    map(result, (value) => value.id);
  const done = (result: Result<unknown>): Result<void> => map(result, () => undefined);
  return {
    targetsOf: async (spaceId, userId) => {
      const accounts = (await sources.accounts.listBySpace(spaceId)).filter((a) => a.ownerUserId === userId);
      const groups = await sources.categories.listGroups(spaceId);
      const categories = await sources.categories.listCategories(spaceId);
      return ok({
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          archived: a.archivedAt !== null,
        })),
        groups: groups.map((g) => ({ id: g.id, name: g.name, key: g.key, archived: g.archivedAt !== null })),
        categories: categories.map((c) => ({
          id: c.id,
          groupId: c.groupId,
          parentCategoryId: c.parentCategoryId,
          name: c.name,
          key: c.key,
          archived: c.archivedAt !== null,
        })),
      });
    },
    movementsOf: async (spaceId, accountIds, from, to) => {
      const movements: HearthMovement[] = [];
      for (const accountId of accountIds) {
        for (const tx of await liveMovements(spaceId, accountId, from, to)) {
          const movement = movementOnAccount(tx, accountId);
          if (movement !== null) movements.push(movement);
        }
      }
      return movements;
    },
    createAccount: async ({ cutOffDay, paymentDay, ...input }) =>
      idOf(
        await sources.createAccount({
          ...input,
          currency: input.openingBalance.currency.code,
          // HU-E2-06: only a card takes billing days.
          ...(input.type === "CREDIT_CARD" ? { terms: { cutOffDay, paymentDay } } : {}),
        }),
      ),
    createCategoryGroup: async ({ emoji, ...input }) => {
      const created = await sources.createCategoryGroup({
        ...input,
        ...(emoji === null ? {} : { icon: { kind: "EMOJI" as const, value: emoji } }),
      });
      // D22 allows one emoji: one it refuses as an icon only costs the icon, never the group.
      if (!created.ok && emoji !== null && created.error.code === "InvalidCategoryIcon") {
        return idOf(await sources.createCategoryGroup(input));
      }
      return idOf(created);
    },
    archiveCategoryGroup: async (input) => done(await sources.archiveCategoryGroup(input)),
    restoreCategoryGroup: async (input) => done(await sources.restoreCategoryGroup(input)),
    usedCategoryIds: async (spaceId) =>
      new Set(
        [...(await sources.usageCounts.usageCountsOf(spaceId))].filter(([, n]) => n > 0).map(([id]) => id),
      ),
    createCategory: async ({ emoji, ...input }) => {
      const created = await sources.createCategory({
        ...input,
        ...(emoji === null ? {} : { icon: { kind: "EMOJI" as const, value: emoji } }),
      });
      // D22 allows one emoji: one it refuses as an icon only costs the icon, never the category.
      if (!created.ok && emoji !== null && created.error.code === "InvalidCategoryIcon") {
        return idOf(await sources.createCategory(input));
      }
      return idOf(created);
    },
    recordExpense: async ({ time, ...input }) =>
      map(
        await sources.recordExpense({ ...input, ...importedWhen(time) }),
        (recorded) => recorded.expense.id,
      ),
    recordIncome: async ({ time, ...input }) =>
      idOf(await sources.recordIncome({ ...input, ...importedWhen(time) })),
    recordTransfer: async ({ time, ...input }) =>
      idOf(await sources.recordTransfer({ ...input, ...importedWhen(time) })),
    recordAdjustment: async ({ time, ...input }) =>
      idOf(await sources.recordAdjustment({ ...input, ...importedWhen(time) })),
    deleteMovement: async ({ movementId, ...input }) => {
      const deleted = await sources.deleteTransaction({ ...input, transactionId: movementId });
      // D8: a movement the person deleted already stays as they left it, and this call did not delete it.
      if (!deleted.ok && deleted.error.code === "TransactionNotFound") return ok(false);
      return map(deleted, () => true);
    },
    openDirectSpaceWithGuest: async (input) =>
      map(await sources.startDirectSpaceWithGuest(input), ({ spaceId }) => ({ spaceId: String(spaceId) })),
    recordPersonSettlement: async ({ time, ...input }) =>
      idOf(await sources.recordPairSettlement({ ...input, ...importedWhen(time) })),
    archiveAccount: async (input) => done(await sources.archiveAccount(input)),
    restoreAccount: async (input) => done(await sources.restoreAccount(input)),
    archiveCategory: async (input) => done(await sources.archiveCategory(input)),
    restoreCategory: async (input) => done(await sources.restoreCategory(input)),
    accountInUse: async (spaceId, accountId) =>
      (await sources.ledgerQueries.list({ spaceId, ...ALL_DATES, accountId }, null, 1)).length > 0,
    categoryInUse: async (spaceId, categoryId) =>
      ((await sources.usageCounts.usageCountsOf(spaceId)).get(categoryId) ?? 0) > 0,
  };
};
