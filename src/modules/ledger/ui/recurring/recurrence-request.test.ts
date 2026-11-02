import { describe, expect, it } from "vitest";
import type { SplitDraft } from "../split/split-request";
import {
  changesOf,
  definitionOf,
  recurrenceFieldOf,
  stepDay,
  type RecurrenceDraft,
} from "./recurrence-request";

const rent: RecurrenceDraft = {
  type: "EXPENSE",
  amount: "1.200.000",
  description: " Arriendo ",
  category: { categoryId: "c-rent", subcategoryId: null },
  accountId: "a-bank",
  toAccountId: null,
  fundId: null,
  schedule: { kind: "MONTHLY", day: 1, day1: 15, day2: 30 },
  mode: "AUTO",
  startDate: "2026-12-01",
  endDate: null,
};
const input = { currency: "COP", numberFormat: "DOT_COMMA" as const, meMemberId: "m-ana" };
const split = (overrides: Partial<SplitDraft> = {}): SplitDraft => ({
  payer: { kind: "FUND", accountId: "a-fund" },
  method: "EQUAL",
  selected: ["m-ana", "m-juan"],
  values: {},
  chosen: false,
  ...overrides,
});

describe("a recurrence's request (HU-E9-09)", () => {
  it("defines a personal expense paid by the definer from the chosen account", () => {
    expect(definitionOf(rent, input)).toEqual({
      ok: true,
      body: {
        description: "Arriendo",
        amount: { amount: "120000000", currency: "COP" },
        template: {
          type: "EXPENSE",
          categoryId: "c-rent",
          payer: { memberId: "m-ana", accountId: "a-bank" },
        },
        schedule: { kind: "MONTHLY", day: 1 },
        mode: "AUTO",
        startDate: "2026-12-01",
      },
    });
  });

  it("leaves a split nobody chose to each occurrence, and sends a chosen one (P23)", () => {
    const shared = { split: split(), memberIds: ["m-ana", "m-juan"] };
    const plain = definitionOf(rent, { ...input, shared });
    expect(plain.ok && plain.body.template).toEqual({
      type: "EXPENSE",
      categoryId: "c-rent",
      payer: { memberId: null, accountId: "a-fund" },
    });
    const chosen = definitionOf(rent, { ...input, shared: { ...shared, split: split({ chosen: true }) } });
    expect(chosen.ok && (chosen.body.template as { split: unknown }).split).toEqual({
      method: "EQUAL",
      participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }],
    });
  });

  it("refuses exact amounts, which a recurrence does not offer", () => {
    const exact = split({ chosen: true, method: "EXACT" });
    expect(
      definitionOf(rent, { ...input, shared: { split: exact, memberIds: ["m-ana", "m-juan"] } }),
    ).toEqual({
      ok: false,
      field: "split",
      reason: "exactSplit",
    });
  });

  it("names a semi-monthly schedule's two days and an end date", () => {
    const built = definitionOf(
      { ...rent, schedule: { kind: "SEMI_MONTHLY", day: 1, day1: 15, day2: 30 }, endDate: "2027-06-30" },
      input,
    );
    expect(built.ok && built.body).toMatchObject({
      schedule: { kind: "SEMI_MONTHLY", day1: 15, day2: 30 },
      endDate: "2027-06-30",
    });
  });

  it("asks for what it cannot build: the amount, the category, the accounts", () => {
    expect(definitionOf({ ...rent, amount: "abc" }, input)).toEqual({ ok: false, field: "amount" });
    expect(definitionOf({ ...rent, category: null }, input)).toEqual({ ok: false, field: "category" });
    expect(definitionOf({ ...rent, type: "TRANSFER" }, input)).toEqual({ ok: false, field: "toAccount" });
    expect(definitionOf({ ...rent, type: "FUND_CONTRIBUTION" }, input)).toEqual({ ok: false, field: "fund" });
  });

  it("edits only what a PATCH may change, the end date included", () => {
    expect(changesOf({ ...rent, endDate: null }, input)).toEqual({
      ok: true,
      body: {
        description: "Arriendo",
        amount: { amount: "120000000", currency: "COP" },
        categoryId: "c-rent",
        schedule: { kind: "MONTHLY", day: 1 },
        mode: "AUTO",
        endDate: null,
      },
    });
  });

  it("keeps a day between 1 and 31", () => {
    expect([stepDay(1, -1), stepDay(31, 1), stepDay(15, 1)]).toEqual([1, 31, 16]);
  });

  it("shows a schedule's problem under the dates", () => {
    const problem = { code: "InvalidRecurrence", status: 422, errors: [] } as never;
    expect(recurrenceFieldOf(problem)).toBe("dates");
  });
});
