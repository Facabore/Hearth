import { describe, expect, it } from "vitest";
import { codeOf, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import {
  archiveGroup,
  archivedTree,
  movedTree,
  newCategory,
  newGroup,
  renameGroup,
  restoreCategory,
  restyleGroup,
  reviseCategory,
  shownStyle,
  type Category,
  type CategoryGroup,
} from "./category";
import { CUSTOM_GROUP_STYLE, type CategoryStyle, type StyleChange } from "./category-style";

const now = new Date("2026-10-12T12:00:00Z");
const ids = sequentialIds("c");
const group = (id: string, name: string, archivedAt: Date | null = null): CategoryGroup => ({
  id: id as CategoryGroup["id"],
  spaceId: "space-ana",
  name,
  key: null,
  style: CUSTOM_GROUP_STYLE,
  archivedAt,
  createdAt: now,
});
const category = (id: string, groupId: string, name: string, key: string | null = null): Category => ({
  id: id as Category["id"],
  spaceId: "space-ana",
  groupId: groupId as CategoryGroup["id"],
  parentCategoryId: null,
  style: CUSTOM_GROUP_STYLE,
  name,
  key,
  archivedAt: null,
  createdAt: now,
});

const food = group("g-food", "Food");
const health = group("g-health", "Health");
const groceries = category("c-groceries", "g-food", "Groceries", "groceries");
const pharmacy = category("c-pharmacy", "g-health", "Pharmacy", "pharmacy");
const all = [groceries, pharmacy];

describe("category tree rules (HU-E3-02)", () => {
  it("creates a user category in a group, trimmed and without catalog key", () => {
    const bakery = newCategory({
      id: ids.next<"Category">(),
      group: food,
      name: " Bakery ",
      now,
      categories: all,
    });
    expect(unwrap(bakery)).toMatchObject({ name: "Bakery", groupId: "g-food", key: null, archivedAt: null });
  });

  it("rejects a duplicate name in the same group ignoring case", () => {
    const result = newCategory({
      id: ids.next<"Category">(),
      group: food,
      name: "groceries",
      now,
      categories: all,
    });
    expect(codeOf(result)).toBe("CategoryNameTaken");
  });

  it.each(["   ", "x".repeat(61)])("rejects the name %j", (name) => {
    expect(codeOf(newCategory({ id: ids.next<"Category">(), group: food, name, now, categories: all }))).toBe(
      "InvalidCategoryName",
    );
  });

  it("refuses new categories in an archived group", () => {
    const archived = group("g-old", "Old", now);
    const result = newCategory({
      id: ids.next<"Category">(),
      group: archived,
      name: "Pets",
      now,
      categories: all,
    });
    expect(codeOf(result)).toBe("CategoryGroupArchived");
  });

  it("renames a seeded category without changing its key", () => {
    expect(unwrap(reviseCategory(groceries, { name: "Supermarket" }, all))).toMatchObject({
      name: "Supermarket",
      key: "groceries",
    });
  });

  it("moves a category to another group", () => {
    expect(unwrap(reviseCategory(pharmacy, { group: food }, all))).toMatchObject({
      id: "c-pharmacy",
      groupId: "g-food",
    });
  });

  it("rejects a move onto a name already used in the target group", () => {
    const otherPharmacy = category("c-other", "g-food", "Pharmacy");
    expect(codeOf(reviseCategory(pharmacy, { group: food }, [...all, otherPharmacy]))).toBe(
      "CategoryNameTaken",
    );
  });

  it("keeps group names unique ignoring case", () => {
    expect(
      codeOf(
        newGroup({
          id: ids.next<"CategoryGroup">(),
          spaceId: "space-ana",
          name: "FOOD",
          now,
          groups: [food],
        }),
      ),
    ).toBe("CategoryGroupNameTaken");
    expect(codeOf(renameGroup(health, "food", [food, health]))).toBe("CategoryGroupNameTaken");
    expect(unwrap(renameGroup(health, "Fun", [food, health])).name).toBe("Fun");
  });
});

describe("archiving (HU-E3-03)", () => {
  it("archives a group with all its categories, which stay archived while the group is", () => {
    const archived = archiveGroup(food, all, now);
    expect(archived.group.archivedAt).toEqual(now);
    expect(archived.categories).toEqual([{ ...groceries, archivedAt: now }]);
    expect(codeOf(restoreCategory(archived.categories[0]!, archived.group))).toBe("CategoryGroupArchived");
  });

  it("restores a category of an active group", () => {
    expect(unwrap(restoreCategory({ ...groceries, archivedAt: now }, food)).archivedAt).toBeNull();
  });
});

describe("subcategories (HU-E3-04)", () => {
  const sub = (id: string, parent: Category, name: string): Category => ({
    ...category(id, parent.groupId, name),
    parentCategoryId: parent.id,
    style: null,
  });
  const vegetables = sub("c-vegetables", groceries, "Vegetables");
  const meat = sub("c-meat", groceries, "Meat");
  const tree = [...all, vegetables, meat];
  const create = (parent: Category, name: string, categories: readonly Category[] = tree) =>
    newCategory({ id: ids.next<"Category">(), group: food, parent, name, now, categories });

  it("creates a subcategory in its parent's group, without catalog key", () => {
    expect(unwrap(create(groceries, " Fruit "))).toMatchObject({
      groupId: "g-food",
      parentCategoryId: "c-groceries",
      name: "Fruit",
      key: null,
    });
  });

  it("refuses a fourth level, and a parent that is archived", () => {
    expect(codeOf(create(vegetables, "Organic"))).toBe("CategoryDepthExceeded");
    expect(codeOf(create({ ...groceries, archivedAt: now }, "Fruit"))).toBe("ParentCategoryArchived");
  });

  it("keeps names unique among siblings only", () => {
    expect(codeOf(create(groceries, "vegetables"))).toBe("CategoryNameTaken");
    expect(codeOf(create(groceries, "Pharmacy"))).toBe("ok");
  });

  it("lets a subcategory share a name with a category of its group, and a category with one of another group", () => {
    const snacks = category("c-snacks", "g-food", "Snacks");
    expect(codeOf(create(groceries, "Snacks", [...tree, snacks]))).toBe("ok");
    const pharmacyInFood = newCategory({
      id: ids.next<"Category">(),
      group: food,
      name: "Pharmacy",
      now,
      categories: tree,
    });
    expect(codeOf(pharmacyInFood)).toBe("ok");
  });

  it("moves a leaf under a category and back to a group, but never a category that has subcategories", () => {
    expect(unwrap(reviseCategory(pharmacy, { parent: groceries }, tree))).toMatchObject({
      groupId: "g-food",
      parentCategoryId: "c-groceries",
    });
    expect(unwrap(reviseCategory(vegetables, { parent: null }, tree))).toMatchObject({
      groupId: "g-food",
      parentCategoryId: null,
    });
    expect(unwrap(reviseCategory(vegetables, { group: health }, tree))).toMatchObject({
      groupId: "g-health",
      parentCategoryId: null,
    });
    expect(codeOf(reviseCategory(groceries, { parent: pharmacy }, tree))).toBe("CategoryDepthExceeded");
    expect(codeOf(reviseCategory(pharmacy, { parent: vegetables }, tree))).toBe("CategoryDepthExceeded");
    expect(codeOf(reviseCategory(pharmacy, { parent: pharmacy }, tree))).toBe("CategoryDepthExceeded");
  });

  it("keeps a subcategory under its parent when a revision names neither a group nor a parent", () => {
    expect(unwrap(reviseCategory(vegetables, { name: "Fruit" }, tree))).toMatchObject({
      name: "Fruit",
      groupId: "g-food",
      parentCategoryId: "c-groceries",
    });
  });

  it("refuses renaming into a sibling's name on the revise path, with the code of the create path", () => {
    expect(codeOf(reviseCategory(vegetables, { name: "meat" }, tree))).toBe("CategoryNameTaken");
  });

  it("refuses moving a category under an archived parent", () => {
    const archivedGroceries = { ...groceries, archivedAt: now };
    expect(codeOf(reviseCategory(pharmacy, { parent: archivedGroceries }, tree))).toBe(
      "ParentCategoryArchived",
    );
  });

  it("carries the subcategories along when their category changes group", () => {
    const moved = unwrap(reviseCategory(groceries, { group: health }, tree));
    expect(movedTree(moved, tree).map((c) => [c.id, c.groupId])).toEqual([
      ["c-groceries", "g-health"],
      ["c-vegetables", "g-health"],
      ["c-meat", "g-health"],
    ]);
  });

  it("archives the subcategories with their category, and restores one only under a live parent", () => {
    const archived = archivedTree(groceries, tree, now);
    expect(archived.map((c) => [c.id, c.archivedAt])).toEqual([
      ["c-groceries", now],
      ["c-vegetables", now],
      ["c-meat", now],
    ]);
    const [parent, archivedVegetables] = archived as [Category, Category];
    expect(codeOf(restoreCategory(archivedVegetables, food, parent))).toBe("ParentCategoryArchived");
    expect(unwrap(restoreCategory(archivedVegetables, food, groceries)).archivedAt).toBeNull();
  });
});

describe("category styles (HU-E3-05)", () => {
  const cart: CategoryStyle = { icon: { kind: "SYMBOL", name: "cart" }, color: "SAND" };
  const plum: CategoryStyle = { icon: { kind: "EMOJI", value: "🛒" }, color: "PLUM" };
  const styledFood: CategoryGroup = {
    ...food,
    style: { icon: { kind: "SYMBOL", name: "apple" }, color: "SAND" },
  };
  const styledGroceries: Category = { ...groceries, style: cart };
  const vegetables: Category = {
    ...category("c-vegetables", "g-food", "Vegetables"),
    parentCategoryId: groceries.id,
    style: null,
  };
  const tree = [styledGroceries, pharmacy, vegetables];
  const create = (style?: StyleChange, parent?: Category) =>
    newCategory({
      id: ids.next<"Category">(),
      group: styledFood,
      parent,
      name: "Bakery",
      now,
      categories: tree,
      style,
    });

  it("gives a new group the custom style under what is sent, and restyles a group part by part", () => {
    const pets = (style?: StyleChange) =>
      unwrap(
        newGroup({
          id: ids.next<"CategoryGroup">(),
          spaceId: "space-ana",
          name: "Pets",
          now,
          groups: [],
          style,
        }),
      );
    expect(pets().style).toEqual(CUSTOM_GROUP_STYLE);
    expect(pets({ color: "MUSTARD" }).style).toEqual({ icon: CUSTOM_GROUP_STYLE.icon, color: "MUSTARD" });
    expect(restyleGroup(styledFood, { icon: plum.icon }).style).toEqual({ icon: plum.icon, color: "SAND" });
  });

  it("gives a new group no catalog key, and keeps a seeded group's key through a rename, a restyle and an archive", () => {
    const seeded: CategoryGroup = { ...styledFood, key: "food" };
    const pets = unwrap(
      newGroup({ id: ids.next<"CategoryGroup">(), spaceId: "space-ana", name: "Pets", now, groups: [] }),
    );
    expect(pets.key).toBeNull();
    expect(unwrap(renameGroup(seeded, "Eating", [seeded])).key).toBe("food");
    expect(restyleGroup(seeded, { color: "ROSE" }).key).toBe("food");
    expect(archiveGroup(seeded, [], now).group.key).toBe("food");
  });

  it("copies the group's style into a new category, under what is sent", () => {
    expect(unwrap(create()).style).toEqual(styledFood.style);
    expect(unwrap(create({ color: "ROSE" })).style).toEqual({ icon: styledFood.style.icon, color: "ROSE" });
  });

  it("gives a subcategory no style of its own, refuses one, and shows its parent's", () => {
    expect(unwrap(create(undefined, styledGroceries)).style).toBeNull();
    expect(codeOf(create({ color: "ROSE" }, styledGroceries))).toBe("ValidationFailed");
    expect(codeOf(reviseCategory(vegetables, { style: { color: "ROSE" } }, tree))).toBe("ValidationFailed");
    expect(shownStyle(vegetables, tree)).toEqual(cart);
    expect(shownStyle(vegetables, [{ ...styledGroceries, style: plum }, vegetables])).toEqual(plum);
    expect(shownStyle(styledGroceries, tree)).toEqual(cart);
  });

  it("restyles a category; a promoted subcategory keeps a copy of its parent's, a demoted category drops its own", () => {
    const bread: CategoryStyle = { icon: { kind: "SYMBOL", name: "bread" }, color: "ROSE" };
    expect(unwrap(reviseCategory(styledGroceries, { style: bread }, tree)).style).toEqual(bread);
    expect(unwrap(reviseCategory(vegetables, { parent: null }, tree)).style).toEqual(cart);
    expect(
      unwrap(reviseCategory(vegetables, { parent: null, style: { color: "SAGE" } }, tree)).style,
    ).toEqual({
      icon: cart.icon,
      color: "SAGE",
    });
    expect(unwrap(reviseCategory(pharmacy, { parent: styledGroceries }, tree)).style).toBeNull();
  });
});
