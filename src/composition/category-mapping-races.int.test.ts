import { afterAll, describe, expect, it } from "vitest";
import {
  createAddBudgetLine,
  createCreateBudgetPlan,
  createMapCategoriesToLine,
  type BudgetCategories,
  type BudgetingDeps,
} from "@/modules/budgeting/application";
import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";
import { createDeleteCategory, type CategoryUsage } from "@/modules/categories/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { money, unwrap } from "../../tests/support/fakes";
import { categoryFixture, sharedSpaceFixture, userFixture } from "../../tests/support/fixtures";
import { heldBy, holder, outcomesOf } from "../../tests/support/locks";
import { budgetCategoriesOf, categoryUsageOf } from "./container";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const plans = new DrizzleBudgetPlanRepository(tm);
const categories = new DrizzleCategoryRepository(tm);
const ids = new UuidV7IdGenerator();
const clock = new FixedClock(new Date("2026-11-02T17:00:00Z"));

afterAll(() => pool.end());

type Holder = ReturnType<typeof holder>;

/** The plans' deps over PostgreSQL, their categories as the composition root binds them; a test may hold them. */
const budgetingDeps = (planCategories: BudgetCategories = budgetCategoriesOf(categories)): BudgetingDeps => ({
  access: createSpaceAccess(spaces),
  spaceLocks: spaces,
  members: spaces,
  plans,
  spending: { expensesByCategory: async () => [], transfersIntoAccounts: async () => [] },
  savingsAccounts: { find: async () => null },
  categories: planCategories,
  ids,
  clock,
  tm,
});

/** The plans' categories as bound, but whoever lists them stops in `h.hold()` once it has read them. */
const holdingList = (h: Holder): BudgetCategories => {
  const bound = budgetCategoriesOf(categories);
  return {
    ...bound,
    list: async (spaceId) => {
      const listed = await bound.list(spaceId);
      await h.hold();
      return listed;
    },
  };
};

/** The delete as the composition root builds it; it stops in `h.hold()` once it found the category unreferenced. */
const deleteOf = (h?: Holder) => {
  const bound = categoryUsageOf(new DrizzleLedgerQueries(tm), plans);
  const usage: CategoryUsage = {
    isCategoryReferenced: async (categoryId) => {
      const referenced = await bound.isCategoryReferenced(categoryId);
      await h?.hold();
      return referenced;
    },
  };
  return createDeleteCategory({ categories, access: createSpaceAccess(spaces), ids, clock, tm, usage });
};

/** Household with Ana as OWNER, a "Groceries" category and a November plan with one 500,000 line named "Market". */
const world = async () => {
  const ana = await userFixture(pool, "Ana");
  const space = await sharedSpaceFixture(db, ana.id);
  const owner = { userId: ana.id, spaceId: space.id, memberId: space.members[0]!.id };
  const groceries = await categoryFixture(db, owner);
  const deps = budgetingDeps();
  const { plan } = unwrap(
    await createCreateBudgetPlan(deps)({ spaceId: space.id, userId: ana.id, period: "2026-11" }),
  );
  await plans.setCapacities(plan.id, [{ memberId: owner.memberId, amount: 100_000_000n }], clock.now());
  unwrap(
    await createAddBudgetLine({ ...deps, lines: plans })({
      spaceId: space.id,
      userId: ana.id,
      planId: plan.id,
      expectedVersion: null,
      line: { name: "Market", plannedAmount: money(50_000_000n) },
    }),
  );
  const [line] = (await plans.contents(plan.id)).lines;
  const mapping = (deps: BudgetingDeps = budgetingDeps()) =>
    createMapCategoriesToLine({ ...deps, mappings: plans })({
      spaceId: space.id,
      userId: ana.id,
      planId: plan.id,
      lineId: line!.id,
      expectedVersion: null,
      categoryIds: [groceries],
    });
  const deleting = (h?: Holder) => deleteOf(h)({ spaceId: space.id, userId: ana.id, categoryId: groceries });
  return { groceries, mapping, deleting };
};

/** Mappings, ended ones included, that name a deleted category: the damage the race does. */
const mappingsOfDeletedCategories = async (categoryId: string): Promise<number> =>
  Number(
    (
      await pool.query(
        `SELECT count(*) AS n FROM budget_line_categories m JOIN categories c ON c.id = m.category_id
          WHERE c.id = $1 AND c.deleted_at IS NOT NULL`,
        [categoryId],
      )
    ).rows[0].n,
  );

describe("deleting a category against a concurrent mapping (#245, M3A-7)", () => {
  it("answers CategoryNotInSpace to a mapping that waited for the delete to commit", async () => {
    const w = await world();
    const h = holder(tm, pool);
    const removal = w.deleting(h);
    await heldBy(h, removal);
    const mapping = w.mapping().finally(h.release);
    expect(await outcomesOf(removal, mapping)).toEqual(["CategoryNotInSpace", "ok"]);
    expect(await mappingsOfDeletedCategories(w.groceries)).toBe(0);
  });

  it("answers CategoryInUse to a delete that waited for a mapping of the category to commit", async () => {
    const w = await world();
    const h = holder(tm, pool);
    const mapping = w.mapping(budgetingDeps(holdingList(h)));
    await heldBy(h, mapping);
    const removal = w.deleting().finally(h.release);
    expect(await outcomesOf(mapping, removal)).toEqual(["CategoryInUse", "ok"]);
    expect(await mappingsOfDeletedCategories(w.groceries)).toBe(0);
  });
});
