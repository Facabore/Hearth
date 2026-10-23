import { describe, expect, it } from "vitest";
import { codeOf, fakeSpaceAccess, membership, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import type { LedgerDeps } from "./deps";
import { createRecordExpense } from "./record-expense";
import { createRecordExpenseByCategoryKey } from "./record-expense-by-category-key";

/**
 * Ana's personal space, whose "groceries" category was seeded under that catalog key (D11). The reader
 * answers null for a category that was logically deleted (Task 0a), like the categories repository's list.
 */
const catalog: Readonly<Record<string, { id: string; archived: boolean } | null>> = {
  groceries: { id: CATEGORIES.groceries.id, archived: false },
  "old-habit": { id: CATEGORIES.archived.id, archived: true },
  "deleted-habit": null,
};

const setup = (overrides: Partial<LedgerDeps> = {}) => {
  const fixture = ledgerFixture(overrides);
  const record = createRecordExpenseByCategoryKey(
    {
      access: fixture.deps.access,
      spaceLocks: fixture.deps.spaceLocks,
      categoryKeys: {
        findByKey: async (spaceId, key) => (spaceId === "space-ana" ? (catalog[key] ?? null) : null),
      },
    },
    createRecordExpense(fixture.deps),
  );
  return { ...fixture, record };
};
const market = {
  spaceId: "space-ana",
  userId: "u-ana",
  amount: money(5_000_000n),
  accountId: ACCOUNTS.bancolombia.id,
};

describe("RecordExpenseByCategoryKey (HU-E1-13, D11)", () => {
  it("records the expense in the category seeded with that key", async () => {
    const { record, store } = setup();
    const recorded = unwrap(await record({ ...market, categoryKey: "groceries" }));
    expect(recorded.expense).toMatchObject({ categoryId: CATEGORIES.groceries.id, amount: 5_000_000n });
    expect(store.rows).toHaveLength(1);
  });

  it("answers CategoryNotFound for an unknown key and records nothing", async () => {
    const { record, store } = setup();
    expect(codeOf(await record({ ...market, categoryKey: "no-such-key" }))).toBe("CategoryNotFound");
    expect(store.rows).toEqual([]);
  });

  it("answers CategoryNotFound for a category deleted logically, which the reader no longer finds", async () => {
    const { record, store } = setup();
    expect(codeOf(await record({ ...market, categoryKey: "deleted-habit" }))).toBe("CategoryNotFound");
    expect(store.rows).toEqual([]);
  });

  it("answers CategoryArchived for an archived category, as RecordExpense does, and records nothing", async () => {
    const { record, store } = setup();
    expect(codeOf(await record({ ...market, categoryKey: "old-habit" }))).toBe("CategoryArchived");
    expect(store.rows).toEqual([]);
  });

  it("hides another space from non-members before looking at its categories", async () => {
    const { record } = setup();
    const elsewhere = { ...market, spaceId: "space-juan", categoryKey: "no-such-key" };
    expect(codeOf(await record(elsewhere))).toBe("SpaceNotFound");
  });

  it("forbids a viewer before looking at the categories, whatever the key", async () => {
    const { record, store } = setup({ access: fakeSpaceAccess(membership({ role: "VIEWER" })) });
    expect(codeOf(await record({ ...market, categoryKey: "no-such-key" }))).toBe("InsufficientRole");
    expect(codeOf(await record({ ...market, categoryKey: "groceries" }))).toBe("InsufficientRole");
    expect(store.rows).toEqual([]);
  });
});
