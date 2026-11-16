import { describe, expect, it } from "vitest";
import { proposeMappings, type HearthTargets } from "./mapping-proposals";
import type { SourceSnapshot } from "./source-snapshot";

const snapshot: SourceSnapshot = {
  sourceApp: "money-manager",
  accounts: [
    {
      sourceId: "a-cash",
      name: "Efectivo",
      type: "CASH",
      currency: "COP",
      order: 0,
      cutOffDay: null,
      paymentDay: null,
      memo: null,
      hidden: false,
      excludedFromTotals: false,
    },
    {
      sourceId: "a-usd",
      name: "US savings",
      type: "BANK",
      currency: "USD",
      order: 1,
      cutOffDay: null,
      paymentDay: null,
      memo: null,
      hidden: false,
      excludedFromTotals: false,
    },
    {
      sourceId: "a-linked",
      name: "Renamed in Hearth",
      type: "BANK",
      currency: "COP",
      order: 2,
      cutOffDay: null,
      paymentDay: null,
      memo: null,
      hidden: false,
      excludedFromTotals: false,
    },
  ],
  categories: [
    {
      sourceId: "c-food",
      name: "Food",
      icon: "🍔",
      kind: "EXPENSE",
      parentSourceId: null,
      deleted: false,
      order: 0,
    },
    {
      sourceId: "c-sub",
      name: "Supermercado",
      icon: null,
      kind: "EXPENSE",
      parentSourceId: "c-food",
      deleted: false,
      order: 0,
    },
    {
      sourceId: "c-guitar",
      name: "Guitarra",
      icon: "🎸",
      kind: "EXPENSE",
      parentSourceId: null,
      deleted: false,
      order: 1,
    },
  ],
  movements: [],
  budgets: [],
  settings: { startDay: null, mainCurrency: "COP" },
  skipped: { zeroAmountMovements: 0, deletedCategories: 0 },
  warnings: [],
  errors: [],
};

const targets: HearthTargets = {
  accounts: [
    { id: "h-cash", name: "efectivo", currency: "COP", archived: false },
    { id: "h-usd-cop", name: "US savings", currency: "COP", archived: false },
    { id: "h-linked", name: "Something else", currency: "COP", archived: false },
  ],
  groups: [
    { id: "g-food", key: "food", archived: false },
    { id: "g-other", key: "other", archived: false },
  ],
  categories: [
    {
      id: "h-groceries",
      groupId: "g-food",
      parentCategoryId: null,
      name: "Mercado",
      key: "groceries",
      archived: false,
    },
    {
      id: "h-super",
      groupId: "g-food",
      parentCategoryId: "h-groceries",
      name: "supermercado",
      key: null,
      archived: false,
    },
  ],
};

describe("proposeMappings (design §2.1, §2.2, §3.3)", () => {
  const mappings = proposeMappings(
    snapshot,
    targets,
    { accounts: new Map([["a-linked", "h-linked"]]), categories: new Map() },
    "America/Bogota",
  );

  it("maps an account to its linked account, else to one of the same name and currency, else to a new one", () => {
    expect(mappings.accounts).toEqual({
      "a-cash": { kind: "existing", accountId: "h-cash" },
      "a-usd": { kind: "new", type: "BANK", currency: "USD" },
      "a-linked": { kind: "existing", accountId: "h-linked" },
    });
  });

  it("maps a built-in category to its catalog category, merges a subcategory of the same name, and puts the rest in Otros", () => {
    expect(mappings.categories).toEqual({
      "c-food": { kind: "existing", categoryId: "h-groceries" },
      "c-sub": { kind: "existing", categoryId: "h-super" },
      "c-guitar": { kind: "new", groupId: "g-other" },
    });
  });

  it("starts in the given zone with no duplicate included", () => {
    expect(mappings.timeZone).toBe("America/Bogota");
    expect(mappings.includeDuplicates).toEqual([]);
  });
});
