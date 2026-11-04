import { afterAll, describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { categoryFixture, personalSpaceFixture } from "../../../../tests/support/fixtures";
import { heldBy, holder, outcomesOf } from "../../../../tests/support/locks";
import type { CategoryRepository } from "../application/category-repository";
import { createCreateCategory } from "../application/create-category";
import { createDeleteCategory } from "../application/delete-category";
import type { CategoriesDeps } from "../application/deps";
import { createMoveCategoryGroup } from "../application/move-category-group";
import { DrizzleCategoryRepository } from "./drizzle-category-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repository = new DrizzleCategoryRepository(tm);
const access = createSpaceAccess(new DrizzleSpaceRepository(tm));

afterAll(() => pool.end());

/**
 * The real repository, but whoever reads the categories stops in `hold()` once it has read them: that writer is inside
 * its transaction, deciding on what it read, until another backend queues behind a lock it holds. Without the tree lock
 * no one queues, the other writer runs to the end first, and the held one goes on with a stale reading.
 */
class HoldingCategories extends DrizzleCategoryRepository {
  constructor(
    manager: DrizzleTransactionManager,
    private readonly stop: ReturnType<typeof holder>,
  ) {
    super(manager);
  }

  override async listCategories(spaceId: string) {
    const rows = await super.listCategories(spaceId);
    await this.stop.hold();
    return rows;
  }
}

/** Ana, OWNER of her personal space, with the category "Groceries" in it; `deps` over a given repository. */
const world = async () => {
  const space = await personalSpaceFixture(db, pool);
  const groceries = await categoryFixture(db, space, "Groceries");
  const deps = (categories: CategoryRepository = repository): CategoriesDeps => ({
    categories,
    access,
    ids: new UuidV7IdGenerator(),
    clock: new FixedClock(new Date("2026-10-17T12:00:00Z")),
    tm,
  });
  const asAna = { spaceId: space.spaceId, userId: space.userId };
  const storedUnder = async (parentId: string) =>
    (await pool.query("SELECT 1 FROM categories WHERE parent_category_id = $1", [parentId])).rowCount;
  return { space, groceries, deps, asAna, storedUnder };
};

describe("concurrent writes to one space's category tree (ruling P90)", () => {
  it("creates one of two simultaneous subcategories with the same name and answers the other CategoryNameTaken", async () => {
    const w = await world();
    const input = { ...w.asAna, parentCategoryId: w.groceries, name: "Vegetables" };
    const h = holder(tm, pool);
    const first = createCreateCategory(w.deps(new HoldingCategories(tm, h)))(input);
    await heldBy(h, first);
    const second = createCreateCategory(w.deps())(input).finally(h.release);
    expect(await outcomesOf(first, second)).toEqual(["CategoryNameTaken", "ok"]);
    expect(await w.storedUnder(w.groceries)).toBe(1);
  });

  it("answers CategoryNotFound to a subcategory created under a category that a delete in progress removes", async () => {
    const w = await world();
    const h = holder(tm, pool);
    const removing = createDeleteCategory({
      ...w.deps(new HoldingCategories(tm, h)),
      usage: { isCategoryReferenced: async () => false },
    })({ ...w.asAna, categoryId: w.groceries });
    await heldBy(h, removing);
    const creating = createCreateCategory(w.deps())({
      ...w.asAna,
      parentCategoryId: w.groceries,
      name: "Vegetables",
    }).finally(h.release);
    expect(await outcomesOf(removing, creating)).toEqual(["CategoryNotFound", "ok"]);
    expect(await w.storedUnder(w.groceries)).toBe(0);
  });
});

/** The real repository, but whoever reads the groups stops in `hold()` once it has read them (see HoldingCategories). */
class HoldingGroups extends DrizzleCategoryRepository {
  constructor(
    manager: DrizzleTransactionManager,
    private readonly stop: ReturnType<typeof holder>,
  ) {
    super(manager);
  }

  override async listGroups(spaceId: string) {
    const rows = await super.listGroups(spaceId);
    await this.stop.hold();
    return rows;
  }
}

describe("concurrent moves of one space's groups (ruling P296, under P90 and #245)", () => {
  it("serializes two moves on the tree lock: the second reads the order the first left, and the places stay dense and unique", async () => {
    const w = await world();
    // Each fixture category comes in a fresh group, last.
    await categoryFixture(db, w.space, "Fuel");
    await categoryFixture(db, w.space, "Pharmacy");
    const stored = async () =>
      (
        await pool.query("SELECT id, position FROM category_groups WHERE space_id = $1 ORDER BY position", [
          w.space.spaceId,
        ])
      ).rows as { id: string; position: number }[];
    const [a, b, c] = (await stored()).slice(-3).map((row) => row.id);
    // Whatever the space starts with, the last three groups are A, B, C; the first move puts C before A, and the
    // second, reading after it, puts A after B. On the order it started from, the second would have kept C last and
    // written A and B onto places the first had just given away.
    const h = holder(tm, pool);
    const first = createMoveCategoryGroup(w.deps(new HoldingGroups(tm, h)))({
      ...w.asAna,
      groupId: c!,
      anchor: { before: a! },
    });
    await heldBy(h, first);
    const second = createMoveCategoryGroup(w.deps())({
      ...w.asAna,
      groupId: a!,
      anchor: { after: b! },
    }).finally(h.release);
    expect(await outcomesOf(first, second)).toEqual(["ok", "ok"]);
    const after = await stored();
    expect(after.slice(-3).map((row) => row.id)).toEqual([c, b, a]);
    expect(after.map((row) => row.position)).toEqual(after.map((_, i) => i));
  });
});
