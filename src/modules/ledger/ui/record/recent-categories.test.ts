import { describe, expect, it } from "vitest";
import { categoryDto, groupDto } from "../../../../../tests/support/ui/dto";
import { offeredRecent, readRecent, rememberRecent, RECENT_LIMIT } from "./recent-categories";

const memoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
};

describe("recent categories (issue #173)", () => {
  it("keeps the newest first, without repeats, per space and kind, up to the limit", () => {
    const storage = memoryStorage();
    for (let i = 0; i < RECENT_LIMIT + 2; i += 1)
      rememberRecent(storage, "sp-1", "EXPENSE", { categoryId: `c-${i}`, subcategoryId: null });
    rememberRecent(storage, "sp-1", "EXPENSE", { categoryId: "c-3", subcategoryId: null });
    const recent = readRecent(storage, "sp-1", "EXPENSE");
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent.map((r) => r.categoryId)).toEqual(["c-3", "c-7", "c-6", "c-5", "c-4", "c-2"]);
    expect(readRecent(storage, "sp-1", "INCOME")).toEqual([]);
    expect(readRecent(storage, "sp-2", "EXPENSE")).toEqual([]);
  });

  it("reads none from a missing, broken or throwing storage", () => {
    expect(readRecent(undefined, "sp-1", "EXPENSE")).toEqual([]);
    const broken = memoryStorage();
    broken.setItem("hearth.recentCategories.sp-1.EXPENSE", "{not json");
    expect(readRecent(broken, "sp-1", "EXPENSE")).toEqual([]);
    const throwing = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readRecent(throwing, "sp-1", "EXPENSE")).toEqual([]);
    expect(() =>
      rememberRecent(throwing, "sp-1", "EXPENSE", { categoryId: "c-1", subcategoryId: null }),
    ).not.toThrow();
  });

  it("offers only the recents whose category and subcategory the sheet still lists", () => {
    const groups = [
      groupDto({
        categories: [
          categoryDto({
            id: "c-food",
            subcategories: [categoryDto({ id: "c-veg", parentCategoryId: "c-food" })],
          }),
        ],
      }),
    ];
    expect(
      offeredRecent(
        [
          { categoryId: "c-food", subcategoryId: "c-veg" },
          { categoryId: "c-food", subcategoryId: "c-gone" },
          { categoryId: "c-archived", subcategoryId: null },
          { categoryId: "c-food", subcategoryId: null },
        ],
        groups,
      ),
    ).toEqual([
      { categoryId: "c-food", subcategoryId: "c-veg" },
      { categoryId: "c-food", subcategoryId: null },
    ]);
  });
});
