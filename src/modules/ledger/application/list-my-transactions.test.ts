import { describe, expect, it } from "vitest";
import type { Category } from "@/modules/categories/application";
import type { MemberPlace, SpaceSummary } from "@/modules/spaces/application";
import { FixedClock, type PeriodPolicy } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  fixedTimeZones,
  membership,
  noStoredPeriods,
  unwrap,
} from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  anExpense,
  anIncome,
  InMemoryTransactions,
} from "../../../../tests/support/in-memory-ledger";
import type { Transaction } from "../domain/transaction";
import {
  createListMyTransactions,
  type MyTransactionPage,
  type MyTransactionsDeps,
  type MyTransactionsInput,
} from "./list-my-transactions";
import type { TransactionPosition } from "./ports";

const pesos = (n: number) => BigInt(n) * 100n;

const summary = (id: string, name: string, kind: SpaceSummary["kind"], currency = "COP"): SpaceSummary => ({
  id,
  name,
  kind,
  currency,
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: kind === "PERSONAL" ? "OWNER" : "MEMBER",
  color: "SKY",
});

const place = (spaceId: string, memberId: string) => ({ memberId, spaceId }) as MemberPlace;

const juanPays = (amount: bigint, shares: readonly [string, bigint][]) => ({
  createdBy: "u-juan",
  payments: [{ memberId: "m-juan", accountId: null, amount }],
  shares: shares.map(([memberId, part]) => ({ memberId, amount: part, splitMethod: "EXACT" as const })),
});

/** Ana's October: her personal space, Hogar (COP), Viaje (USD), an archived space and Lucía's, which is not hers. */
const movements = () => {
  const market = anExpense("2026-10-05", pesos(30_000), {
    spaceId: "sp-ana",
    description: "Market",
    categoryId: "cat-veg-personal",
    payments: [{ memberId: "m-ana-personal", accountId: ACCOUNTS.bancolombia.id, amount: pesos(30_000) }],
    shares: [{ memberId: "m-ana-personal", amount: pesos(30_000), splitMethod: "EQUAL" }],
  });
  const groceries = anExpense("2026-10-06", pesos(180_000), {
    spaceId: "sp-hogar",
    description: "Mercado del mes",
    categoryId: "cat-verduras",
    ...juanPays(pesos(180_000), [
      ["m-juan", pesos(90_000)],
      ["m-ana", pesos(90_000)],
    ]),
  });
  const juansIncome = anIncome("2026-10-07", pesos(50_000), {
    spaceId: "sp-hogar",
    description: "Reembolso",
    categoryId: "cat-hogar-income",
    createdBy: "u-juan",
    destinationAccountId: ACCOUNTS.davivienda.id,
    receivingMemberId: "m-juan",
  });
  const salary = anIncome("2026-10-25", pesos(3_000_000), {
    spaceId: "sp-ana",
    description: "Salary",
    receivingMemberId: "m-ana-personal",
  });
  // Ruling P37: Viaje is in USD, listed but out of the COP sums.
  const hotel = anExpense("2026-10-10", 21_000n, {
    spaceId: "sp-viaje",
    description: "Hotel",
    currency: "USD",
    categoryId: "cat-viaje-hotel",
    payments: [{ memberId: "m-ana-viaje", accountId: null, amount: 21_000n }],
    shares: [
      { memberId: "m-ana-viaje", amount: 7_000n, splitMethod: "EQUAL" },
      { memberId: "m-luis", amount: 14_000n, splitMethod: "EQUAL" },
    ],
  });
  // Recorded through Ana's former member row in Hogar: still hers.
  const oldGas = anExpense("2026-10-03", pesos(20_000), {
    spaceId: "sp-hogar",
    description: "Gas",
    categoryId: "cat-hogar-gas",
    ...juanPays(pesos(20_000), [
      ["m-juan", pesos(10_000)],
      ["m-ana-old", pesos(10_000)],
    ]),
  });
  const archived = anExpense("2026-10-08", pesos(5_000), { spaceId: "sp-old", description: "Old" });
  const lucias = anExpense("2026-10-09", pesos(7_000), { spaceId: "sp-lucia", description: "Lucía's" });
  const september = anExpense("2026-09-20", pesos(9_000), {
    spaceId: "sp-ana",
    description: "September",
    categoryId: "cat-veg-personal",
  });
  return { market, groceries, juansIncome, salary, hotel, oldGas, archived, lucias, september };
};

const category = (id: string, name: string, parentCategoryId: string | null) =>
  ({ id, name, parentCategoryId, style: null }) as Category;

const world = (personalPolicy: PeriodPolicy = { kind: "MONTHLY", day: 1 }) => {
  const m = movements();
  const store = new InMemoryTransactions();
  store.rows.push(...Object.values(m));
  const trees: Record<string, readonly Category[]> = {
    "sp-ana": [category("cat-food", "Food", null), category("cat-veg-personal", "Vegetables", "cat-food")],
    "sp-hogar": [
      category("cat-mercado", "Mercado", null),
      category("cat-verduras", "Verduras", "cat-mercado"),
      category("cat-hogar-gas", "Gas", null),
      category("cat-hogar-income", "Reembolsos", null),
    ],
  };
  const deps: MyTransactionsDeps = {
    spaces: {
      listForUser: async (userId, options) =>
        userId === "u-ana"
          ? [
              summary("sp-ana", "Personal", "PERSONAL"),
              summary("sp-hogar", "Hogar", "SHARED"),
              summary("sp-viaje", "Viaje", "SHARED", "USD"),
              ...(options?.includeArchived ? [summary("sp-old", "Old", "SHARED")] : []),
            ]
          : [],
    },
    places: {
      placesOf: async (userId) =>
        userId === "u-ana"
          ? [
              place("sp-ana", "m-ana-personal"),
              place("sp-hogar", "m-ana-old"),
              place("sp-hogar", "m-ana"),
              place("sp-viaje", "m-ana-viaje"),
              place("sp-old", "m-ana-o"),
            ]
          : [],
    },
    members: {
      namesIn: async (spaceIds) =>
        [
          { memberId: "m-ana", spaceId: "sp-hogar", userId: "u-ana", displayName: "Ana", current: true },
          { memberId: "m-juan", spaceId: "sp-hogar", userId: "u-juan", displayName: "Juan", current: true },
        ].filter((row) => spaceIds.includes(row.spaceId)),
    },
    categories: { listCategories: async (spaceId) => trees[spaceId] ?? [] },
    categoryTree: {
      subcategoriesOf: async (spaceId, ids) =>
        (trees[spaceId] ?? [])
          .filter((c) => c.parentCategoryId !== null && ids.includes(c.parentCategoryId))
          .map((c) => c.id),
    },
    access: fakeSpaceAccess(
      membership({ spaceId: "sp-ana", memberId: "m-ana-personal", periodPolicy: personalPolicy }),
    ),
    storedPeriods: noStoredPeriods,
    clock: new FixedClock(new Date("2026-10-28T15:00:00Z")), // 2026-10-28 in Bogotá
    userTimeZones: fixedTimeZones(),
    query: store,
  };
  const list = (extra: Partial<MyTransactionsInput> = {}) =>
    createListMyTransactions(deps)({ userId: "u-ana", after: null, limit: 50, ...extra });
  const idsOf = async (extra: Partial<MyTransactionsInput> = {}) =>
    unwrap(await list(extra)).items.map((i) => i.transaction.id as string);
  return { m, list, idsOf };
};

const idsOf = (...txs: Transaction[]) => txs.map((tx) => tx.id as string);

describe("ListMyTransactions (ruling P319)", () => {
  it("lists Ana's personal and shared movements of the current period in one order, each with its space", async () => {
    const { m, list } = world();
    const page = unwrap(await list());
    expect(page.period).toEqual({ start: "2026-10-01", end: "2026-10-31", label: "2026-10" });
    expect(page.currency).toBe("COP");
    expect(page.items.map((i) => [i.transaction.id, i.space.name])).toEqual([
      [m.salary.id, "Personal"],
      [m.hotel.id, "Viaje"],
      [m.juansIncome.id, "Hogar"],
      [m.groceries.id, "Hogar"],
      [m.market.id, "Personal"],
      [m.oldGas.id, "Hogar"],
    ]);
    expect(page.nextPosition).toBeNull();
  });

  it("describes a shared movement as Inicio does: who recorded it and Ana's part (P306)", async () => {
    const { m, list } = world();
    const groceries = unwrap(await list()).items.find((i) => i.transaction.id === m.groceries.id);
    expect(groceries).toMatchObject({
      space: { id: "sp-hogar", name: "Hogar", kind: "SHARED" },
      recordedBy: { name: "Juan", you: false },
      you: { memberIds: ["m-ana-old", "m-ana"], share: pesos(90_000), paid: null },
      memberNames: { "m-juan": "Juan", "m-ana": "Ana" },
      category: { name: "Verduras", path: "Mercado › Verduras", style: null },
    });
  });

  it("never lists an archived space nor a space Ana does not belong to, and answers SpaceNotFound for either", async () => {
    const { m, idsOf: ids, list } = world();
    const listed = await ids();
    expect(listed).not.toContain(m.archived.id);
    expect(listed).not.toContain(m.lucias.id);
    expect(codeOf(await list({ spaceId: "sp-lucia" }))).toBe("SpaceNotFound");
    expect(codeOf(await list({ spaceId: "sp-old" }))).toBe("SpaceNotFound");
  });

  it("narrows to one of Ana's spaces, totals included", async () => {
    const { m, list } = world();
    const page = unwrap(await list({ spaceId: "sp-hogar" }));
    expect(page.items.map((i) => i.transaction.id)).toEqual(idsOf(m.juansIncome, m.groceries, m.oldGas));
    expect(page.totals).toEqual({ share: pesos(100_000), income: 0n });
  });

  it("matches a category's subcategories in every space (P48)", async () => {
    const { m, idsOf: ids } = world();
    expect(await ids({ categoryIds: ["cat-mercado", "cat-food"] })).toEqual(idsOf(m.groceries, m.market));
    expect(await ids({ categoryIds: ["cat-verduras"] })).toEqual(idsOf(m.groceries));
  });

  it("filters by account, type and a piece of the description (P277)", async () => {
    const { m, list, idsOf: ids } = world();
    expect(await ids({ accountId: ACCOUNTS.bancolombia.id })).toEqual(idsOf(m.salary, m.market));
    const incomes = unwrap(await list({ type: "INCOME" }));
    expect(incomes.items.map((i) => i.transaction.id)).toEqual(idsOf(m.salary, m.juansIncome));
    expect(incomes.totals).toEqual({ share: 0n, income: pesos(3_000_000) });
    expect(await ids({ search: "  mercado " })).toEqual(idsOf(m.groceries));
    expect(await ids({ search: "   " })).toHaveLength(6);
  });

  it("reads the period of Ana's personal space: by its label, or the current one by her policy", async () => {
    const { m, idsOf: ids, list } = world();
    expect(await ids({ period: "2026-09" })).toEqual(idsOf(m.september));
    expect(codeOf(await list({ period: "2026-13" }))).toBe("InvalidPeriodLabel");
    const fifteenth = world({ kind: "MONTHLY", day: 15 });
    const page = unwrap(await fifteenth.list());
    expect(page.period.label).toBe("2026-10");
    expect([page.period.start, page.period.end]).toEqual(["2026-10-15", "2026-11-14"]);
    expect(page.items.map((i) => i.transaction.id)).toEqual(idsOf(fifteenth.m.salary));
  });

  it("pages through every space in one order, without repeating or skipping a movement (P43)", async () => {
    const { list } = world();
    const all = unwrap(await list()).items.map((i) => i.transaction.id);
    const seen: string[] = [];
    let after: TransactionPosition | null = null;
    let pages = 0;
    do {
      const page: MyTransactionPage = unwrap(await list({ after, limit: 4 }));
      seen.push(...page.items.map((i) => i.transaction.id));
      expect(page.totals).toEqual({ share: pesos(130_000), income: pesos(3_000_000) });
      after = page.nextPosition;
      pages++;
    } while (after);
    expect(pages).toBe(2);
    expect(seen).toEqual(all);
  });

  it("sums Ana's share of the expenses and the incomes she received, leaving another currency out (P37)", async () => {
    const { m, list } = world();
    const page = unwrap(await list());
    // 30.000 (Market) + 90.000 (her half of the groceries) + 10.000 (through her former row); not Juan's income.
    expect(page.totals).toEqual({ share: pesos(130_000), income: pesos(3_000_000) });
    const viaje = unwrap(await list({ spaceId: "sp-viaje" }));
    expect(viaje.items.map((i) => i.transaction.id)).toEqual(idsOf(m.hotel));
    expect(viaje.items[0]!.you.share).toBe(7_000n);
    expect(viaje.totals).toEqual({ share: 0n, income: 0n });
    expect(viaje.currency).toBe("COP");
  });
});
