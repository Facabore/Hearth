import { afterAll, describe, expect, it } from "vitest";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";
import { createDeleteCategory, type CategoryUsage } from "@/modules/categories/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { createRecordExpense, type LedgerDeps } from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { fixedTimeZones, money } from "../../tests/support/fakes";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../tests/support/fixtures";
import { heldBy, holder, outcomesOf } from "../../tests/support/locks";
import { categoryUsageOf, ledgerCategoriesOf } from "./container";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const accounts = new DrizzleAccountRepository(tm);
const categories = new DrizzleCategoryRepository(tm);
const ledgerQueries = new DrizzleLedgerQueries(tm);
const ids = new UuidV7IdGenerator();
const clock = new FixedClock(new Date("2026-11-02T17:00:00Z"));

afterAll(() => pool.end());

type Holder = ReturnType<typeof holder>;

/** The ledger's deps over PostgreSQL, its categories as the composition root binds them; a test may hold them. */
const ledgerDeps = (
  ledgerCategories: LedgerDeps["categories"] = ledgerCategoriesOf(categories),
): LedgerDeps => ({
  access: createSpaceAccess(spaces),
  members: spaces,
  spaceLocks: spaces,
  transactions: new DrizzleTransactionRepository(tm),
  query: ledgerQueries,
  audit: new DrizzleAuditLog(tm),
  accounts: {
    find: async (accountId) => {
      const account = await accounts.findById(accountId);
      return account
        ? {
            id: account.id,
            spaceId: account.spaceId,
            ownerUserId: account.ownerUserId,
            isSharedFund: account.type === "SHARED_FUND",
            archived: account.archivedAt !== null,
          }
        : null;
    },
  },
  accountBalances: { balanceOf: async () => 0n },
  categories: ledgerCategories,
  closedPeriods: { isClosed: async () => false },
  defaultSplits: { allocationWeights: async () => null },
  storedPeriods: async () => [],
  ids,
  clock,
  timeZone: "America/Bogota",
  userTimeZones: fixedTimeZones(),
  tm,
});

/** The ledger's categories as bound, but whoever looks one up stops in `h.hold()` once it has read it. */
const holdingLookup = (h: Holder): LedgerDeps["categories"] => {
  const bound = ledgerCategoriesOf(categories);
  return {
    ...bound,
    find: async (spaceId, categoryId) => {
      const category = await bound.find(spaceId, categoryId);
      await h.hold();
      return category;
    },
  };
};

/** The delete as the composition root builds it; it stops in `h.hold()` once it found the category unreferenced. */
const deleteOf = (h?: Holder) => {
  const bound = categoryUsageOf(ledgerQueries, new DrizzleBudgetPlanRepository(tm));
  const usage: CategoryUsage = {
    isCategoryReferenced: async (categoryId) => {
      const referenced = await bound.isCategoryReferenced(categoryId);
      await h?.hold();
      return referenced;
    },
  };
  return createDeleteCategory({ categories, access: createSpaceAccess(spaces), ids, clock, tm, usage });
};

const groceries = (w: SharedLedgerFixture, deps = ledgerDeps()) =>
  createRecordExpense(deps)({
    spaceId: w.household.spaceId,
    userId: w.household.userId,
    description: "Groceries",
    amount: money(5_000_000n),
    categoryId: w.groceries,
    accountId: w.bank,
  });

const deleting = (w: SharedLedgerFixture, h?: Holder) =>
  deleteOf(h)({ spaceId: w.household.spaceId, userId: w.household.userId, categoryId: w.groceries });

/** Movements that name a deleted category: the damage the race does. */
const movementsOnDeletedCategories = async (spaceId: string): Promise<number> =>
  Number(
    (
      await pool.query(
        `SELECT count(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
          WHERE t.space_id = $1 AND c.deleted_at IS NOT NULL`,
        [spaceId],
      )
    ).rows[0].n,
  );

const isDeleted = async (categoryId: string): Promise<boolean> =>
  (await pool.query("SELECT deleted_at IS NOT NULL AS deleted FROM categories WHERE id = $1", [categoryId]))
    .rows[0].deleted as boolean;

describe("deleting a category against a new ledger reference (#245, M1-1)", () => {
  it("answers CategoryNotFound to an expense that waited for the delete to commit", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const h = holder(tm, pool);
    const removal = deleting(w, h);
    await heldBy(h, removal);
    const recording = groceries(w).finally(h.release);
    expect(await outcomesOf(removal, recording)).toEqual(["CategoryNotFound", "ok"]);
    expect(await isDeleted(w.groceries)).toBe(true);
    expect(await movementsOnDeletedCategories(w.household.spaceId)).toBe(0);
  });

  it("answers CategoryInUse to a delete that waited for an expense on the category to commit", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const h = holder(tm, pool);
    const recording = groceries(w, ledgerDeps(holdingLookup(h)));
    await heldBy(h, recording);
    const removal = deleting(w).finally(h.release);
    expect(await outcomesOf(recording, removal)).toEqual(["CategoryInUse", "ok"]);
    expect(await isDeleted(w.groceries)).toBe(false);
    expect(await movementsOnDeletedCategories(w.household.spaceId)).toBe(0);
  });
});
