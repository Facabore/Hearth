import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import { createArchiveCategoryGroup } from "./archive-category-group";
import { createCreateCategory } from "./create-category";
import { createCreateCategoryGroup } from "./create-category-group";
import { createDeleteCategoryGroup } from "./delete-category-group";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createMoveCategoryGroup } from "./move-category-group";
import { createRenameCategoryGroup } from "./rename-category-group";
import { createRestoreCategory } from "./restore-category";
import { createRestoreCategoryGroup } from "./restore-category-group";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const household = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const luis = membership({ ...household, memberId: "member-luis", userId: "u-luis", role: "MEMBER" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });
const asAna = { spaceId: "space-household", userId: "u-ana" };
const NOW = new Date("2026-11-20T15:00:00Z");

/** Household seeded in English; Leisure's Games is used by movements (P297 counts), as a past movement would be. */
const setup = async () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(household, luis, sofi),
    ids: sequentialIds("cat"),
    clock: new FixedClock(NOW),
    tm: memoryTm,
  };
  unwrap(await createSeedDefaultCategories(deps)({ spaceId: "space-household", locale: "en" }));
  const group = (name: string) => categories.groups.find((g) => g.name === name)!;
  const named = (name: string) => categories.categories.find((c) => c.name === name)!;
  const list = createListCategories({
    ...deps,
    counts: { usageCountsOf: async () => new Map([[named("Games").id, 3]]) },
  });
  return {
    categories,
    group,
    named,
    list: async (includeArchived: boolean) => unwrap(await list({ ...asAna, includeArchived })),
    remove: createDeleteCategoryGroup(deps),
    createGroup: createCreateCategoryGroup(deps),
    create: createCreateCategory(deps),
    update: createUpdateCategory(deps),
    rename: createRenameCategoryGroup(deps),
    move: createMoveCategoryGroup(deps),
    archiveGroup: createArchiveCategoryGroup(deps),
    restoreGroup: createRestoreCategoryGroup(deps),
    restore: createRestoreCategory(deps),
  };
};

describe("deleting a category group (P347)", () => {
  it("deletes a group whose categories movements use, with every category and subcategory, keeping the rows", async () => {
    const { categories, group, named, create, remove } = await setup();
    const leisure = group("Leisure");
    const pinball = unwrap(await create({ ...asAna, parentCategoryId: named("Games").id, name: "Pinball" }));

    expect(codeOf(await remove({ ...asAna, groupId: leisure.id }))).toBe("ok");

    expect(categories.groups.find((g) => g.id === leisure.id)).toMatchObject({
      deletedAt: NOW,
      archivedAt: NOW,
    });
    const inLeisure = categories.categories.filter((c) => c.groupId === leisure.id);
    expect(inLeisure.map((c) => c.name)).toEqual(expect.arrayContaining(["Games", "Travel", "Pinball"]));
    expect(inLeisure.every((c) => categories.deleted.get(c.id)?.getTime() === NOW.getTime())).toBe(true);
    expect(inLeisure.every((c) => c.archivedAt !== null)).toBe(true);
    expect(await categories.listGroups("space-household")).not.toContainEqual(
      expect.objectContaining({ id: leisure.id }),
    );
    expect((await categories.listCategories("space-household")).map((c) => c.id)).not.toContain(pinball.id);
  });

  it("lets only the tree's managers delete, and answers a deleted or unknown group with CategoryGroupNotFound", async () => {
    const { group, remove } = await setup();
    const leisure = group("Leisure");
    for (const userId of ["u-luis", "u-sofi"]) {
      expect(codeOf(await remove({ spaceId: "space-household", userId, groupId: leisure.id }))).toBe(
        "InsufficientRole",
      );
    }
    expect(group("Leisure").deletedAt).toBeUndefined();

    unwrap(await remove({ ...asAna, groupId: leisure.id }));
    expect(codeOf(await remove({ ...asAna, groupId: leisure.id }))).toBe("CategoryGroupNotFound");
    expect(codeOf(await remove({ ...asAna, groupId: "nope" }))).toBe("CategoryGroupNotFound");
  });

  it("keeps when each category was archived before, and never brings back one deleted on its own", async () => {
    const { categories, group, named, create, remove } = await setup();
    const leisure = group("Leisure");
    const archivedBefore = new Date("2026-10-01T12:00:00Z");
    await categories.saveCategories([{ ...named("Travel"), archivedAt: archivedBefore }]);
    const bowling = unwrap(await create({ ...asAna, groupId: leisure.id, name: "Bowling" }));
    // Deleted on its own a day before the group (DeleteCategory, which only an unused category passes).
    const bowlingDeletedAt = new Date("2026-11-19T15:00:00Z");
    await categories.deleteCategory("space-household", bowling.id, bowlingDeletedAt);

    unwrap(await remove({ ...asAna, groupId: leisure.id }));

    const history = await categories.listCategoriesForHistory("space-household");
    expect(history.find((c) => c.name === "Travel")).toMatchObject({
      archivedAt: archivedBefore,
      deletedAt: NOW,
    });
    expect(history.find((c) => c.name === "Games")).toMatchObject({ archivedAt: NOW, deletedAt: NOW });
    expect(history.map((c) => c.id)).not.toContain(bowling.id);
    expect(categories.deleted.get(bowling.id)).toBe(bowlingDeletedAt);
  });

  it("leaves the group out of the list, and lists it last among the archived ones only marked deleted", async () => {
    const { group, remove, list } = await setup();
    const leisure = group("Leisure");
    unwrap(await remove({ ...asAna, groupId: leisure.id }));

    expect((await list(false)).map((g) => g.id)).not.toContain(leisure.id);
    const everything = await list(true);
    const deleted = everything.at(-1)!;
    expect(deleted).toMatchObject({ id: leisure.id, archivedAt: NOW, deletedAt: NOW });
    expect(everything.slice(0, -1).every((g) => g.deletedAt === undefined)).toBe(true);
    // Its categories still name their movements: names, styles and counts, archived and deleted.
    const games = deleted.categories.find((c) => c.name === "Games")!;
    expect(games).toMatchObject({ archivedAt: NOW, deletedAt: NOW, usageCount: 3 });
  });

  it("frees the name for a new group and closes the gap in the order", async () => {
    const { categories, group, remove, createGroup } = await setup();
    const leisure = group("Leisure");
    unwrap(await remove({ ...asAna, groupId: leisure.id }));

    const live = await categories.listGroups("space-household");
    expect(live.map((g) => g.position)).toEqual(live.map((_, i) => i));
    const again = unwrap(await createGroup({ ...asAna, name: "leisure" }));
    expect(again).toMatchObject({ name: "leisure", position: live.length });
    expect(again.id).not.toBe(leisure.id);
  });

  it("never restores, archives, renames, moves or fills a deleted group, nor restores its categories", async () => {
    const { group, named, remove, restoreGroup, archiveGroup, rename, move, create, update, restore } =
      await setup();
    const leisure = group("Leisure");
    const food = group("Food");
    unwrap(await remove({ ...asAna, groupId: leisure.id }));

    const onGroup = { ...asAna, groupId: leisure.id };
    expect(codeOf(await restoreGroup(onGroup))).toBe("CategoryGroupNotFound");
    expect(codeOf(await archiveGroup(onGroup))).toBe("CategoryGroupNotFound");
    expect(codeOf(await rename({ ...onGroup, name: "Fun" }))).toBe("CategoryGroupNotFound");
    expect(codeOf(await move({ ...onGroup, anchor: { before: food.id } }))).toBe("CategoryGroupNotFound");
    expect(codeOf(await move({ ...asAna, groupId: food.id, anchor: { after: leisure.id } }))).toBe(
      "CategoryGroupNotFound",
    );
    expect(codeOf(await create({ ...onGroup, name: "Bowling" }))).toBe("CategoryGroupNotFound");
    const games = named("Games");
    expect(codeOf(await restore({ ...asAna, categoryId: games.id }))).toBe("CategoryNotFound");
    expect(codeOf(await update({ ...asAna, categoryId: games.id, groupId: food.id }))).toBe(
      "CategoryNotFound",
    );
  });
});
