import { describe, expect, it } from "vitest";
import { codeOf, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import {
  archiveGroup,
  newCategory,
  newGroup,
  renameGroup,
  restoreCategory,
  reviseCategory,
  type Category,
  type CategoryGroup,
} from "./category";

const now = new Date("2026-10-12T12:00:00Z");
const ids = sequentialIds("c");
const group = (id: string, name: string, archivedAt: Date | null = null): CategoryGroup => ({
  id: id as CategoryGroup["id"],
  spaceId: "space-ana",
  name,
  archivedAt,
  createdAt: now,
});
const category = (id: string, groupId: string, name: string, key: string | null = null): Category => ({
  id: id as Category["id"],
  spaceId: "space-ana",
  groupId: groupId as CategoryGroup["id"],
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
