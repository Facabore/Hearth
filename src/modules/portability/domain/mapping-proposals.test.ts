import { describe, expect, it } from "vitest";
import {
  checkMappings,
  freeName,
  proposeMappings,
  type HearthTargets,
  type PriorLinks,
} from "./mapping-proposals";
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
    { id: "g-food", name: "Alimentación", key: "food", archived: false },
    { id: "g-other", name: "Otros", key: "other", archived: false },
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

const noLinks: PriorLinks = {
  accounts: new Map(),
  categories: new Map(),
  undoneAccounts: new Map(),
  undoneCategories: new Map(),
};

describe("proposeMappings (design §2.1, §2.2, §3.3)", () => {
  const mappings = proposeMappings(
    snapshot,
    targets,
    { ...noLinks, accounts: new Map([["a-linked", "h-linked"]]) },
    "America/Bogota",
  );

  it("maps an account to its linked account, else to one of the same name and currency, else to a new one", () => {
    expect(mappings.accounts).toEqual({
      "a-cash": { kind: "existing", accountId: "h-cash" },
      // "US savings" is taken by a COP account: the new USD account gets a name no account holds.
      "a-usd": { kind: "new", type: "BANK", currency: "USD", name: "US savings (Money Manager)" },
      "a-linked": { kind: "existing", accountId: "h-linked" },
    });
  });

  it("maps a built-in category to its catalog category, merges a subcategory of the same name, and puts the rest in Otros", () => {
    expect(mappings.categories).toEqual({
      "c-food": { kind: "existing", categoryId: "h-groceries" },
      "c-sub": { kind: "existing", categoryId: "h-super" },
      "c-guitar": { kind: "new", groupId: "g-other", name: "Guitarra" },
    });
  });

  it("starts in the given zone with no duplicate included", () => {
    expect(mappings.timeZone).toBe("America/Bogota");
    expect(mappings.includeDuplicates).toEqual([]);
  });
});

describe("proposals a confirm can use as they are (design §3.3)", () => {
  it("proposes an account an undone import created, archived since, and never a linked one in another currency", () => {
    const archivedCash = { id: "h-old-cash", name: "Efectivo", currency: "COP", archived: true };
    const mappings = proposeMappings(
      snapshot,
      {
        ...targets,
        accounts: [archivedCash, { id: "h-usd", name: "Dólares", currency: "COP", archived: false }],
      },
      {
        ...noLinks,
        accounts: new Map([["a-usd", "h-usd"]]),
        undoneAccounts: new Map([["a-cash", "h-old-cash"]]),
      },
      "America/Bogota",
    );
    expect(mappings.accounts["a-cash"]).toEqual({ kind: "existing", accountId: "h-old-cash" });
    expect(mappings.accounts["a-usd"]).toEqual({
      kind: "new",
      type: "BANK",
      currency: "USD",
      name: "US savings",
    });
  });

  it("names a new account apart from an archived one of the same name, in any currency, ignoring case", () => {
    const mappings = proposeMappings(
      snapshot,
      { ...targets, accounts: [{ id: "old", name: "EFECTIVO", currency: "USD", archived: true }] },
      noLinks,
      "America/Bogota",
    );
    expect(mappings.accounts["a-cash"]).toEqual({
      kind: "new",
      type: "CASH",
      currency: "COP",
      name: "Efectivo (Money Manager)",
    });
  });

  it("puts new categories in the import's own group (groupId null) when the space has no live group", () => {
    const mappings = proposeMappings(snapshot, { accounts: [], groups: [], categories: [] }, noLinks, "UTC");
    expect(mappings.categories["c-guitar"]).toEqual({ kind: "new", groupId: null, name: "Guitarra" });
    expect(mappings.categories["c-sub"]).toEqual({ kind: "new", groupId: null, name: "Supermercado" });
  });
});

describe("freeName", () => {
  it("keeps a free name, then adds (Money Manager), then a number, within 60 characters", () => {
    expect(freeName("Banco", new Set())).toBe("Banco");
    expect(freeName("Banco", new Set(["banco"]))).toBe("Banco (Money Manager)");
    expect(freeName("Banco", new Set(["banco", "banco (money manager)"]))).toBe("Banco (Money Manager) 2");
    const long = "x".repeat(60);
    expect(freeName(long, new Set([long]))).toHaveLength(60);
    expect(freeName(long, new Set([long])).endsWith(" (Money Manager)")).toBe(true);
  });
});

describe("checkMappings (design §3.2)", () => {
  const proposed = proposeMappings(snapshot, targets, noLinks, "America/Bogota");
  const reasonOf = (mappings: typeof proposed, links: PriorLinks = noLinks) => {
    const checked = checkMappings(snapshot, mappings, targets, links);
    return checked.ok
      ? "ok"
      : [checked.error.code, checked.error.details?.reason, checked.error.details?.sourceId];
  };
  const withAccount = (sourceId: string, mapping: (typeof proposed.accounts)[string]) => ({
    ...proposed,
    accounts: { ...proposed.accounts, [sourceId]: mapping },
  });
  const withCategory = (sourceId: string, mapping: (typeof proposed.categories)[string]) => ({
    ...proposed,
    categories: { ...proposed.categories, [sourceId]: mapping },
  });

  it("takes the proposals as they are", () => {
    expect(reasonOf(proposed)).toBe("ok");
  });

  it("names the reason and the source of each refusal", () => {
    const withoutCash = Object.fromEntries(
      Object.entries(proposed.accounts).filter(([id]) => id !== "a-cash"),
    );
    expect(reasonOf({ ...proposed, accounts: withoutCash })).toEqual([
      "InvalidImportMapping",
      "mappingRequired",
      "a-cash",
    ]);
    const withoutSub = Object.fromEntries(
      Object.entries(proposed.categories).filter(([id]) => id !== "c-sub"),
    );
    expect(reasonOf({ ...proposed, categories: withoutSub })).toEqual([
      "InvalidImportMapping",
      "mappingRequired",
      "c-sub",
    ]);
    expect(reasonOf(withAccount("nope", proposed.accounts["a-cash"]!))).toEqual([
      "InvalidImportMapping",
      "unknownSource",
      "nope",
    ]);
    expect(reasonOf(withAccount("a-cash", { kind: "existing", accountId: "gone" }))).toEqual([
      "InvalidImportMapping",
      "accountNotFound",
      "a-cash",
    ]);
    expect(reasonOf(withAccount("a-usd", { kind: "existing", accountId: "h-cash" }))).toEqual([
      "InvalidImportMapping",
      "currencyMismatch",
      "a-usd",
    ]);
    expect(reasonOf(withAccount("a-usd", { kind: "new", type: "BANK", currency: "COP" }))).toEqual([
      "InvalidImportMapping",
      "currencyMismatch",
      "a-usd",
    ]);
    expect(reasonOf(withCategory("c-food", { kind: "existing", categoryId: "gone" }))).toEqual([
      "InvalidImportMapping",
      "categoryNotFound",
      "c-food",
    ]);
    expect(reasonOf(withCategory("c-guitar", { kind: "new", groupId: "gone" }))).toEqual([
      "InvalidImportMapping",
      "groupNotFound",
      "c-guitar",
    ]);
    expect(reasonOf({ ...proposed, includeDuplicates: ["m-nope"] })).toEqual([
      "InvalidImportMapping",
      "unknownSource",
      "m-nope",
    ]);
    expect(reasonOf({ ...proposed, timeZone: "Mars/Olympus" })).toEqual([
      "InvalidTimeZone",
      undefined,
      undefined,
    ]);
  });

  it("takes an archived account only when an undone import of that source created it", () => {
    const archived = {
      ...targets,
      accounts: [{ id: "h-old", name: "Efectivo", currency: "COP", archived: true }],
    };
    const mappings = withAccount("a-cash", { kind: "existing", accountId: "h-old" });
    expect(checkMappings(snapshot, mappings, archived, noLinks).ok).toBe(false);
    const undone = { ...noLinks, undoneAccounts: new Map([["a-cash", "h-old"]]) };
    expect(checkMappings(snapshot, mappings, archived, undone).ok).toBe(true);
  });

  it("settles a name the person chose that a record already holds", () => {
    const checked = checkMappings(
      snapshot,
      withAccount("a-cash", { kind: "new", type: "CASH", currency: "COP", name: "efectivo" }),
      targets,
      noLinks,
    );
    expect(checked.ok && checked.value.accounts["a-cash"]).toEqual({
      kind: "new",
      type: "CASH",
      currency: "COP",
      name: "efectivo (Money Manager)",
    });
  });
});
