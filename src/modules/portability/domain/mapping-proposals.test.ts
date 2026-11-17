import { describe, expect, it } from "vitest";
import { localDate, Money, type LocalDate } from "@/shared/kernel";
import {
  accountOptionsOf,
  checkMappings,
  freeName,
  proposeMappings,
  type HearthTargets,
  type PriorLinks,
} from "./mapping-proposals";
import type { SourceAccount, SourceMovement, SourceSnapshot } from "./source-snapshot";

const day = (iso: string): LocalDate => {
  const parsed = localDate(iso);
  if (!parsed.ok) throw new Error(iso);
  return parsed.value;
};

/** An income of 10.00 into `account`, so that account is no empty one (P337 suggests archiving those). */
const incomeInto = (account: string, currency = "COP"): SourceMovement => {
  const amount = Money.ofMinor(1000n, currency);
  if (!amount.ok) throw new Error(currency);
  return {
    sourceKey: `m-${account}`,
    kind: "INCOME",
    date: day("2025-01-10"),
    occurredAt: null,
    accountSourceId: account,
    toAccountSourceId: null,
    categorySourceId: "c-food",
    amount: amount.value,
    originalAmount: null,
    toAmount: null,
    note: null,
  };
};

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
  movements: [incomeInto("a-cash"), incomeInto("a-usd", "USD")],
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
    "COP",
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
      "COP",
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
      "COP",
    );
    expect(mappings.accounts["a-cash"]).toEqual({
      kind: "new",
      type: "CASH",
      currency: "COP",
      name: "Efectivo (Money Manager)",
    });
  });

  it("puts new categories in the import's own group (groupId null) when the space has no live group", () => {
    const mappings = proposeMappings(
      snapshot,
      { accounts: [], groups: [], categories: [] },
      noLinks,
      "UTC",
      "COP",
    );
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
  const proposed = proposeMappings(snapshot, targets, noLinks, "America/Bogota", "COP");
  const reasonOf = (mappings: typeof proposed, links: PriorLinks = noLinks) => {
    const checked = checkMappings(snapshot, mappings, targets, links, "COP");
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
    expect(checkMappings(snapshot, mappings, archived, noLinks, "COP").ok).toBe(false);
    const undone = { ...noLinks, undoneAccounts: new Map([["a-cash", "h-old"]]) };
    expect(checkMappings(snapshot, mappings, archived, undone, "COP").ok).toBe(true);
  });

  it("settles a name the person chose that a record already holds", () => {
    const checked = checkMappings(
      snapshot,
      withAccount("a-cash", { kind: "new", type: "CASH", currency: "COP", name: "efectivo" }),
      targets,
      noLinks,
      "COP",
    );
    expect(checked.ok && checked.value.accounts["a-cash"]).toEqual({
      kind: "new",
      type: "CASH",
      currency: "COP",
      name: "efectivo (Money Manager)",
    });
  });
});

describe("what each account is (P337, board 1)", () => {
  const account = (
    sourceId: string,
    name: string,
    overrides: Partial<SourceAccount> = {},
  ): SourceAccount => ({
    sourceId,
    name,
    type: "BANK",
    currency: "COP",
    order: 0,
    cutOffDay: null,
    paymentDay: null,
    memo: null,
    hidden: false,
    excludedFromTotals: false,
    ...overrides,
  });
  const sorting: SourceSnapshot = {
    ...snapshot,
    accounts: [
      account("a-bank", "Bancolombia"),
      account("a-mom", "Mom Loan", { type: "OTHER", loan: true }),
      account("a-cash", "Cash", { type: "CASH" }),
      account("a-card", "Visa", { type: "CREDIT_CARD" }),
      account("a-old", "Old", { hidden: true }),
    ],
    movements: [incomeInto("a-bank"), incomeInto("a-mom"), incomeInto("a-cash"), incomeInto("a-old")],
  };
  const mine: HearthTargets = {
    ...targets,
    accounts: [{ id: "h-cash", name: "Efectivo", currency: "COP", archived: false }],
  };

  it("proposes Persona, Archivar into a starter duplicate, Archivar for an empty or hidden account, else Cuenta", () => {
    const proposed = proposeMappings(sorting, mine, noLinks, "America/Bogota", "COP");
    expect(proposed.accounts).toEqual({
      "a-bank": { kind: "new", type: "BANK", currency: "COP", name: "Bancolombia" },
      "a-mom": { kind: "person", name: "Mom" },
      "a-cash": { kind: "archive", accountId: "h-cash", type: "CASH", currency: "COP" },
      "a-card": { kind: "archive", accountId: null, type: "CREDIT_CARD", currency: "COP", name: "Visa" },
      "a-old": { kind: "archive", accountId: null, type: "BANK", currency: "COP", name: "Old" },
    });
    expect(checkMappings(sorting, proposed, mine, noLinks, "COP")).toEqual({ ok: true, value: proposed });
  });

  it("offers each account's three ready mappings, its suggestion, its duplicate and how many movements touch it", () => {
    const options = accountOptionsOf(sorting, mine, noLinks, "COP");
    expect(options.get("a-cash")).toEqual({
      suggested: "ARCHIVE",
      options: {
        account: { kind: "new", type: "CASH", currency: "COP" },
        person: { kind: "person", name: "Cash" },
        archive: { kind: "archive", accountId: "h-cash", type: "CASH", currency: "COP" },
      },
      duplicateOf: mine.accounts[0],
      movementCount: 1,
    });
    expect(options.get("a-mom")).toMatchObject({ suggested: "PERSON", duplicateOf: null, movementCount: 1 });
    expect(options.get("a-card")).toMatchObject({ suggested: "ARCHIVE", movementCount: 0 });
  });

  it("archives into the account an import of this source created and archived, never a new one beside it", () => {
    const visa = { id: "h-visa", name: "Visa", currency: "COP", archived: true };
    const links = { ...noLinks, accounts: new Map([["a-card", "h-visa"]]) };
    const proposed = proposeMappings(
      sorting,
      { ...mine, accounts: [...mine.accounts, visa] },
      links,
      "UTC",
      "COP",
    );
    expect(proposed.accounts["a-card"]).toEqual({
      kind: "archive",
      accountId: "h-visa",
      type: "CREDIT_CARD",
      currency: "COP",
    });
    expect(
      checkMappings(sorting, proposed, { ...mine, accounts: [...mine.accounts, visa] }, links, "COP").ok,
    ).toBe(true);
    // Any other archived account is not one to put movements in.
    expect(
      checkMappings(sorting, proposed, { ...mine, accounts: [...mine.accounts, visa] }, noLinks, "COP"),
    ).toEqual(expect.objectContaining({ ok: false }));
  });

  it("refuses a Persona in another currency than the space's, and names a Persona left unnamed after its source", () => {
    const proposed = proposeMappings(sorting, mine, noLinks, "UTC", "COP");
    const asPerson = {
      ...proposed,
      accounts: { ...proposed.accounts, "a-bank": { kind: "person" as const } },
    };
    const checked = checkMappings(sorting, asPerson, mine, noLinks, "COP");
    expect(checked.ok && checked.value.accounts["a-bank"]).toEqual({ kind: "person", name: "Bancolombia" });
    const refused = checkMappings(sorting, asPerson, mine, noLinks, "USD");
    expect(refused.ok ? null : [refused.error.code, refused.error.details?.reason]).toEqual([
      "InvalidImportMapping",
      "currencyMismatch",
    ]);
  });

  it("refuses an Archivar into another currency, and settles the name of a new archived account", () => {
    const proposed = proposeMappings(sorting, mine, noLinks, "UTC", "COP");
    const into = (mapping: (typeof proposed.accounts)[string]) =>
      checkMappings(
        sorting,
        { ...proposed, accounts: { ...proposed.accounts, "a-old": mapping } },
        mine,
        noLinks,
        "COP",
      );
    const usd = into({ kind: "archive", accountId: null, type: "BANK", currency: "USD" });
    expect(usd.ok ? null : usd.error.details?.reason).toBe("currencyMismatch");
    const taken = into({ kind: "archive", accountId: null, type: "BANK", currency: "COP", name: "Efectivo" });
    expect(taken.ok && taken.value.accounts["a-old"]).toMatchObject({ name: "Efectivo (Money Manager)" });
  });
});
