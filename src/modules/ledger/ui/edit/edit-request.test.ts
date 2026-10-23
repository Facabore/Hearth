import { describe, expect, it } from "vitest";
import { cop, transactionDto } from "../../../../../tests/support/ui/dto";
import { editBodyOf, ifMatchOf } from "./edit-request";

const time = { date: "2026-10-31", occurredAt: "2026-10-31T17:30:00.000Z", timeZone: "America/Bogota" };
const money = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
const personal = {
  description: "Market",
  ...time,
  categoryId: "c-groceries",
  amount: money(85_000),
  accountId: "a-bank",
};
const without = (body: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));
const single = transactionDto({
  type: "EXPENSE",
  shares: [{ memberId: "m-ana", amount: cop(85_000), splitMethod: "EQUAL" }],
});
const two = transactionDto({
  type: "EXPENSE",
  payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(300_000) }],
  shares: [
    { memberId: "m-ana", amount: cop(150_000), splitMethod: "EQUAL" },
    { memberId: "m-juan", amount: cop(150_000), splitMethod: "EQUAL" },
  ],
});
const alone = transactionDto({
  type: "EXPENSE",
  payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(300_000) }],
  shares: [{ memberId: "m-ana", amount: cop(300_000), splitMethod: "EQUAL" }],
});
const payments = (pesos: number, accountId: string | null = "a-bank", memberId: string | null = "m-ana") => [
  { memberId, accountId, amount: money(pesos) },
];
const equal = { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] };
const percent = {
  method: "PERCENT",
  participants: [
    { memberId: "m-ana", percent: "40" },
    { memberId: "m-juan", percent: "60" },
  ],
};
const sharedBody = (pesos: number, extra: Record<string, unknown> = {}) => ({
  ...time,
  categoryId: "c-groceries",
  amount: money(pesos),
  payments: payments(pesos),
  split: equal,
  ...extra,
});

describe("editBodyOf: only what changed travels (ruling P192)", () => {
  it.each([
    ["nothing changed", single, personal, personal, false, {}],
    [
      "the amount",
      single,
      personal,
      { ...personal, amount: money(95_000) },
      false,
      { amount: money(95_000) },
    ],
    ["a cleared description", single, personal, without(personal, "description"), false, { description: "" }],
    [
      "a new description",
      single,
      personal,
      { ...personal, description: "Fruit" },
      false,
      { description: "Fruit" },
    ],
    ["the category", single, personal, { ...personal, categoryId: "c-veg" }, false, { categoryId: "c-veg" }],
    ["the account", single, personal, { ...personal, accountId: "a-nequi" }, false, { accountId: "a-nequi" }],
    [
      "the date and time, which travel whole",
      single,
      personal,
      { ...personal, date: "2026-10-30", occurredAt: "2026-10-30T17:30:00.000Z" },
      true,
      { date: "2026-10-30", occurredAt: "2026-10-30T17:30:00.000Z", timeZone: "America/Bogota" },
    ],
    [
      "a time the form made up for an untimed row",
      single,
      personal,
      { ...personal, occurredAt: "2026-10-31T04:30:00.000Z" },
      false,
      {},
    ],
    [
      "the payer's account",
      two,
      sharedBody(300_000),
      sharedBody(300_000, { payments: payments(300_000, "a-nequi") }),
      false,
      { payments: payments(300_000, "a-nequi") },
    ],
    [
      "the payer switched to a guest",
      two,
      sharedBody(300_000),
      sharedBody(300_000, { payments: payments(300_000, null, "m-pedro") }),
      false,
      { payments: payments(300_000, null, "m-pedro") },
    ],
    [
      "the payer switched to the fund",
      two,
      sharedBody(300_000),
      sharedBody(300_000, { payments: payments(300_000, "a-fund", null) }),
      false,
      { payments: payments(300_000, "a-fund", null) },
    ],
    [
      "the amount of a split expense, which re-sends the split but not the sole payment",
      two,
      sharedBody(300_000),
      sharedBody(400_000, { payments: payments(400_000) }),
      false,
      { amount: money(400_000), split: equal },
    ],
    [
      "the amount of an expense with one share, which re-sends no split",
      alone,
      sharedBody(300_000, { split: { method: "EQUAL", participants: [{ memberId: "m-ana" }] } }),
      sharedBody(400_000, {
        payments: payments(400_000),
        split: { method: "EQUAL", participants: [{ memberId: "m-ana" }] },
      }),
      false,
      { amount: money(400_000) },
    ],
    [
      "only the split",
      two,
      sharedBody(300_000),
      sharedBody(300_000, { split: percent }),
      false,
      { split: percent },
    ],
    [
      "the same payer with a different amount on the payment line, which is not a payer change",
      two,
      sharedBody(300_000),
      sharedBody(300_000, { payments: payments(250_000) }),
      false,
      {},
    ],
  ] as const)("%s", (_name, tx, baseline, current, whenChanged, expected) =>
    expect(editBodyOf({ tx, baseline, current, whenChanged })).toEqual(expected),
  );

  it("never sends payments or a split for an income or a transfer", () => {
    const income = transactionDto({ type: "INCOME", destinationAccountId: "a-bank" });
    const baseline = { ...personal, destinationAccountId: "a-bank", payments: payments(1), split: equal };
    const current = { ...baseline, payments: payments(1, "a-nequi"), split: percent };
    expect(editBodyOf({ tx: income, baseline, current, whenChanged: false })).toEqual({});
  });

  it("sends a transfer's changed accounts by their own keys", () => {
    const transfer = transactionDto({ type: "TRANSFER" });
    const baseline = {
      ...time,
      amount: money(1),
      sourceAccountId: "a-bank",
      destinationAccountId: "a-nequi",
    };
    expect(
      editBodyOf({
        tx: transfer,
        baseline,
        current: { ...baseline, destinationAccountId: "a-visa" },
        whenChanged: false,
      }),
    ).toEqual({ destinationAccountId: "a-visa" });
  });

  it("names the version as the strong ETag the API sends", () => expect(ifMatchOf(4)).toBe('"4"'));
});
