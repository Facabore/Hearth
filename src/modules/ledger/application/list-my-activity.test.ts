import { describe, expect, it } from "vitest";
import type { Category } from "@/modules/categories/application";
import type { MemberPlace, SpaceSummary } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import type { Transaction } from "../domain/transaction";
import { createListMyActivity, type MyActivityDeps } from "./list-my-activity";

const pesos = (n: number) => BigInt(n) * 100n;
const FROM = "2026-11-01" as LocalDate;

const summary = (
  id: string,
  name: string,
  kind: SpaceSummary["kind"],
  color: SpaceSummary["color"],
): SpaceSummary => ({
  id,
  name,
  kind,
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: "MEMBER",
  color,
});

const place = (spaceId: string, memberId: string): MemberPlace =>
  ({
    memberId,
    spaceId,
    spaceName: spaceId,
    spaceKind: "SHARED",
    currency: "COP",
    periodPolicy: { kind: "MONTHLY", day: 1 },
    color: "SKY",
  }) as MemberPlace;

const base = {
  description: "",
  occurredAt: null,
  timeZone: null,
  currency: "COP",
  createdAt: new Date("2026-11-05T12:00:00Z"),
  updatedAt: new Date("2026-11-05T12:00:00Z"),
  deletedAt: null,
  version: 1,
};

/** Juan records the month's groceries in Hogar: he pays 180.000, Ana's part is 90.000. */
const groceries = {
  ...base,
  id: "tx-groceries",
  type: "EXPENSE",
  spaceId: "sp-hogar",
  description: "Mercado del mes",
  date: "2026-11-06",
  amount: pesos(180_000),
  categoryId: "cat-verduras",
  createdBy: "u-juan",
  payments: [{ memberId: "m-juan", accountId: null, amount: pesos(180_000) }],
  shares: [
    { memberId: "m-juan", amount: pesos(90_000), splitMethod: "EQUAL" },
    { memberId: "m-ana", amount: pesos(90_000), splitMethod: "EQUAL" },
  ],
} as unknown as Transaction;

/** Juan pays Ana back in Hogar. */
const settlement = {
  ...base,
  id: "tx-settle",
  type: "SETTLEMENT",
  spaceId: "sp-hogar",
  date: "2026-11-05",
  amount: pesos(50_000),
  categoryId: null,
  createdBy: "u-juan",
  payerMemberId: "m-juan",
  receivingMemberId: "m-ana",
  sourceAccountId: null,
  destinationAccountId: null,
} as unknown as Transaction;

/** Ana records the hotel of the trip and pays it all; her part is a third. */
const hotel = {
  ...base,
  id: "tx-hotel",
  type: "EXPENSE",
  spaceId: "sp-viaje",
  description: "Hotel",
  date: "2026-11-04",
  amount: pesos(210_000),
  categoryId: null,
  createdBy: "u-ana",
  payments: [{ memberId: "m-ana-viaje", accountId: null, amount: pesos(210_000) }],
  shares: [
    { memberId: "m-ana-viaje", amount: pesos(70_000), splitMethod: "EQUAL" },
    { memberId: "m-luis", amount: pesos(140_000), splitMethod: "EQUAL" },
  ],
} as unknown as Transaction;

/** Gas in Hogar, which Juan shares with Luis only. */
const gas = {
  ...groceries,
  id: "tx-gas",
  description: "Gas",
  date: "2026-11-02",
  categoryId: null,
  amount: pesos(45_000),
  payments: [{ memberId: "m-juan", accountId: null, amount: pesos(45_000) }],
  shares: [{ memberId: "m-luis-hogar", amount: pesos(45_000), splitMethod: "EXACT" }],
} as unknown as Transaction;

const category = (id: string, name: string, parentCategoryId: string | null, style: Category["style"]) =>
  ({ id, name, parentCategoryId, style }) as Category;

const world = (transactions: readonly Transaction[] = [groceries, settlement, hotel, gas]) => {
  const asked: { spaceIds: readonly string[]; from: LocalDate; limit: number }[] = [];
  const deps: MyActivityDeps = {
    spaces: {
      listForUser: async (userId) =>
        userId === "u-ana"
          ? [
              summary("sp-ana", "Personal", "PERSONAL", "PINE"),
              summary("sp-hogar", "Hogar", "SHARED", "SKY"),
              summary("sp-viaje", "Viaje Cartagena", "SHARED", "PLUM"),
            ]
          : [],
    },
    places: {
      placesOf: async (userId) =>
        userId === "u-ana"
          ? [place("sp-ana", "m-ana-personal"), place("sp-hogar", "m-ana"), place("sp-viaje", "m-ana-viaje")]
          : [],
    },
    members: {
      namesIn: async (spaceIds) =>
        [
          { memberId: "m-ana", spaceId: "sp-hogar", userId: "u-ana", displayName: "Ana", current: true },
          {
            memberId: "m-juan-old",
            spaceId: "sp-hogar",
            userId: "u-juan",
            displayName: "Juancho",
            current: false,
          },
          { memberId: "m-juan", spaceId: "sp-hogar", userId: "u-juan", displayName: "Juan", current: true },
          {
            memberId: "m-luis-hogar",
            spaceId: "sp-hogar",
            userId: "u-luis",
            displayName: "Luis",
            current: true,
          },
          {
            memberId: "m-ana-viaje",
            spaceId: "sp-viaje",
            userId: "u-ana",
            displayName: "Ana",
            current: true,
          },
          { memberId: "m-luis", spaceId: "sp-viaje", userId: "u-luis", displayName: "Luis", current: true },
        ].filter((row) => spaceIds.includes(row.spaceId)),
    },
    recent: {
      recentIn: async (spaceIds, from, limit) => {
        asked.push({ spaceIds, from, limit });
        return transactions.filter((tx) => spaceIds.includes(tx.spaceId)).slice(0, limit);
      },
    },
    categories: {
      listCategories: async (spaceId) =>
        spaceId === "sp-hogar"
          ? [
              category("cat-mercado", "Mercado", null, {
                icon: { kind: "SYMBOL", name: "basket" },
                color: "SAND",
              }),
              category("cat-verduras", "Verduras", "cat-mercado", null),
            ]
          : [],
    },
  };
  return { deps, asked, list: createListMyActivity(deps) };
};

describe("ListMyActivity (ruling P306)", () => {
  it("lists the movements of Ana's shared spaces only, from the date asked, never a personal space", async () => {
    const w = world();
    const items = unwrap(await w.list({ userId: "u-ana", from: FROM, limit: 10 }));
    expect(w.asked).toEqual([{ spaceIds: ["sp-hogar", "sp-viaje"], from: FROM, limit: 10 }]);
    expect(items.map((i) => [i.transaction.id, i.space.name, i.space.color])).toEqual([
      ["tx-groceries", "Hogar", "SKY"],
      ["tx-settle", "Hogar", "SKY"],
      ["tx-hotel", "Viaje Cartagena", "PLUM"],
      ["tx-gas", "Hogar", "SKY"],
    ]);
  });

  it("says who recorded it by their current name there, and Ana's part of it", async () => {
    const [item] = unwrap(await world().list({ userId: "u-ana", from: FROM, limit: 1 }));
    expect(item).toMatchObject({
      recordedBy: { name: "Juan", you: false },
      you: { memberIds: ["m-ana"], share: pesos(90_000), paid: null },
      memberNames: { "m-juan": "Juan", "m-ana": "Ana" },
    });
  });

  it("names a subcategory under its parent, with the parent's style", async () => {
    const [item] = unwrap(await world().list({ userId: "u-ana", from: FROM, limit: 1 }));
    expect(item!.category).toEqual({
      name: "Verduras",
      path: "Mercado › Verduras",
      style: { icon: { kind: "SYMBOL", name: "basket" }, color: "SAND" },
    });
  });

  it("marks what Ana recorded and paid, and a movement that does not include her", async () => {
    const items = unwrap(await world().list({ userId: "u-ana", from: FROM, limit: 10 }));
    const byId = new Map(items.map((i) => [i.transaction.id as string, i]));
    expect(byId.get("tx-hotel")).toMatchObject({
      recordedBy: { name: "Ana", you: true },
      you: { share: pesos(70_000), paid: pesos(210_000) },
      category: null,
    });
    expect(byId.get("tx-gas")!.you).toEqual({ memberIds: ["m-ana"], share: null, paid: null });
    expect(byId.get("tx-settle")).toMatchObject({
      you: { memberIds: ["m-ana"], share: null, paid: null },
      memberNames: { "m-juan": "Juan", "m-ana": "Ana" },
    });
  });

  it("answers nothing for a person with only their personal space, without reading the ledger", async () => {
    const w = world();
    expect(unwrap(await w.list({ userId: "u-pedro", from: FROM, limit: 10 }))).toEqual([]);
    expect(w.asked).toEqual([]);
  });

  it.each([0, 51, 2.5])("refuses a limit of %s", async (limit) => {
    expect(codeOf(await world().list({ userId: "u-ana", from: FROM, limit }))).toBe("InvalidActivityLimit");
  });
});
