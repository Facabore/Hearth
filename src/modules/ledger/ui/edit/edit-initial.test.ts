import { describe, expect, it } from "vitest";
import {
  accountDto,
  categoryDto,
  cop,
  groupDto,
  guestDto,
  memberDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { draftOf, initialOf } from "./edit-initial";

const groups = [
  groupDto({
    id: "g-food",
    categories: [
      categoryDto({
        id: "c-groceries",
        subcategories: [categoryDto({ id: "c-veg", parentCategoryId: "c-groceries" })],
      }),
    ],
  }),
];
const now = new Date("2026-11-01T04:30:00Z");
const base = { groups, formats: BUILT_IN_FORMATS, zone: "America/Bogota", now };
const shared = {
  members: [
    memberDto({ id: "m-ana", userId: "u-ana" }),
    memberDto({ id: "m-juan", userId: "u-juan" }),
    guestDto({ id: "m-pedro" }),
  ],
  meMemberId: "m-ana",
  myAccounts: [accountDto({ id: "a-bank" })],
  funds: [accountDto({ id: "a-fund", type: "SHARED_FUND" })],
};
type Share = [memberId: string, pesos: number, method: string];
const sharedExpense = (
  shares: Share[],
  payment: { memberId: string | null; accountId: string | null } = { memberId: "m-ana", accountId: "a-bank" },
) => {
  const total = cop(shares.reduce((sum, [, pesos]) => sum + pesos, 0));
  return transactionDto({
    type: "EXPENSE",
    amount: total,
    categoryId: "c-groceries",
    payments: [{ ...payment, amount: total }],
    shares: shares.map(([memberId, pesos, splitMethod]) => ({
      memberId,
      amount: cop(pesos),
      splitMethod: splitMethod as "EQUAL",
    })),
  });
};

describe("initialOf (ruling P192)", () => {
  it("prefills a timed personal expense in its own zone, with the subcategory under its parent", () => {
    const tx = transactionDto({
      type: "EXPENSE",
      description: "Market",
      amount: cop(85_000),
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:30:00.000Z",
      timeZone: "America/Bogota",
      categoryId: "c-veg",
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(85_000) }],
      shares: [{ memberId: "m-ana", amount: cop(85_000), splitMethod: "EQUAL" }],
    });
    // The editor sits in Madrid, but the record has a time of its own: the form reads it in Bogotá.
    expect(initialOf(tx, { ...base, zone: "Europe/Madrid" })).toEqual({
      kind: "EXPENSE",
      amount: "85.000",
      description: "Market",
      category: { categoryId: "c-groceries", subcategoryId: "c-veg" },
      accountId: "a-bank",
      toAccountId: null,
      when: { date: "2026-10-31", wall: { hour: 12, minute: 30 } },
      split: null,
    });
  });

  it("keeps a top-level category as it is", () => {
    const tx = transactionDto({ type: "EXPENSE", categoryId: "c-groceries", amount: cop(1_000) });
    expect(initialOf(tx, base).category).toEqual({ categoryId: "c-groceries", subcategoryId: null });
  });

  it("types an amount with cents in the person's number format", () => {
    const tx = transactionDto({ type: "EXPENSE", amount: { amount: "123456", currency: "COP" } });
    expect(initialOf(tx, base).amount).toBe("1.234,56");
    expect(
      initialOf(tx, { ...base, formats: { ...BUILT_IN_FORMATS, numberFormat: "COMMA_DOT" } }).amount,
    ).toBe("1,234.56");
  });

  it("gives an untimed row the editor's current time without changing its date", () => {
    const tx = transactionDto({
      type: "INCOME",
      date: "2026-10-15",
      destinationAccountId: "a-bank",
      categoryId: "c-groceries",
      amount: cop(1_000),
    });
    expect(initialOf(tx, base)).toMatchObject({
      kind: "INCOME",
      accountId: "a-bank",
      when: { date: "2026-10-15", wall: { hour: 23, minute: 30 } },
    });
  });

  it("prefills a transfer's two accounts", () => {
    const tx = transactionDto({
      type: "TRANSFER",
      sourceAccountId: "a-bank",
      destinationAccountId: "a-nequi",
      amount: cop(50_000),
    });
    expect(initialOf(tx, base)).toMatchObject({
      kind: "TRANSFER",
      accountId: "a-bank",
      toAccountId: "a-nequi",
      category: null,
    });
  });

  it.each([
    [
      "EQUAL",
      [
        ["m-ana", 150_000, "EQUAL"],
        ["m-juan", 150_000, "EQUAL"],
      ],
      "EQUAL",
      {},
    ],
    [
      "EXACT",
      [
        ["m-ana", 100_000, "EXACT"],
        ["m-juan", 150_000, "EXACT"],
      ],
      "EXACT",
      { "m-ana": "100.000", "m-juan": "150.000" },
    ],
    [
      "PERCENT",
      [
        ["m-ana", 100_000, "PERCENT"],
        ["m-juan", 150_000, "PERCENT"],
      ],
      "PERCENT",
      { "m-ana": "40", "m-juan": "60" },
    ],
    [
      "SHARES",
      [
        ["m-ana", 200_000, "SHARES"],
        ["m-juan", 100_000, "SHARES"],
      ],
      "PERCENT",
      { "m-ana": "66,67", "m-juan": "33,33" },
    ],
    [
      "BY_ALLOCATION",
      [
        ["m-ana", 800_000, "BY_ALLOCATION"],
        ["m-juan", 1_200_000, "BY_ALLOCATION"],
      ],
      "PERCENT",
      { "m-ana": "40", "m-juan": "60" },
    ],
  ] as const)("prefills a %s split", (_name, shares, method, values) => {
    const split = initialOf(sharedExpense(shares.map((s) => [...s] as Share)), { ...base, shared }).split!;
    expect(split).toEqual({
      payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
      method,
      selected: ["m-ana", "m-juan"],
      values,
      chosen: true,
    });
  });

  it("makes the percents add up to 100.00: the last participant in join order takes the rest", () => {
    // 100,000 among three: 33,334 / 33,333 / 33,333. Each rounds to 33.33, which makes 99.99 without the correction.
    const split = initialOf(
      sharedExpense([
        ["m-ana", 33_334, "SHARES"],
        ["m-juan", 33_333, "SHARES"],
        ["m-pedro", 33_333, "SHARES"],
      ]),
      { ...base, shared },
    ).split!;
    expect(split.values).toEqual({ "m-ana": "33,33", "m-juan": "33,33", "m-pedro": "33,34" });
  });

  it("lists the share holders in the space's join order, whatever order the shares come in", () => {
    const split = initialOf(
      sharedExpense([
        ["m-juan", 150_000, "EQUAL"],
        ["m-ana", 150_000, "EQUAL"],
      ]),
      { ...base, shared },
    ).split!;
    expect(split.selected).toEqual(["m-ana", "m-juan"]);
  });

  it("names a guest's and the fund's payment as their payer kinds", () => {
    expect(
      initialOf(sharedExpense([["m-ana", 100_000, "EQUAL"]], { memberId: "m-pedro", accountId: null }), {
        ...base,
        shared,
      }).split!.payer,
    ).toEqual({ kind: "GUEST", memberId: "m-pedro" });
    expect(
      initialOf(sharedExpense([["m-ana", 100_000, "EQUAL"]], { memberId: null, accountId: "a-fund" }), {
        ...base,
        shared,
      }).split!.payer,
    ).toEqual({ kind: "FUND", accountId: "a-fund" });
  });

  it("builds no split for an income or a transfer, even in a shared space", () => {
    const tx = transactionDto({ type: "INCOME", destinationAccountId: "a-bank", amount: cop(1_000) });
    expect(initialOf(tx, { ...base, shared }).split).toBeNull();
  });
});

describe("draftOf", () => {
  it("is the draft requestOf reads, in the given zone", () => {
    const initial = initialOf(
      transactionDto({ type: "EXPENSE", amount: cop(1_000), description: "x" }),
      base,
    );
    expect(draftOf(initial, "America/Bogota")).toEqual({
      kind: "EXPENSE",
      amount: "1.000",
      description: "x",
      category: null,
      accountId: null,
      toAccountId: null,
      when: initial.when,
      timeZone: "America/Bogota",
    });
  });
});
