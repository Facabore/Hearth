import { describe, expect, it } from "vitest";
import { money, unwrap } from "../../../../tests/support/fakes";
import { DefineRecurrenceBodySchema, recurrenceFromBody } from "./recurrences.contract";

const rentBody = {
  description: "Rent",
  amount: { amount: "120000000", currency: "COP" },
  template: { type: "EXPENSE", categoryId: "cat-rent", payer: { memberId: null, accountId: "acc-fund" } },
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: "2026-12-01",
};
const parsed = (body: unknown) => DefineRecurrenceBodySchema.parse(body);
const accepts = (body: unknown) => DefineRecurrenceBodySchema.safeParse(body).success;
const withTemplate = (template: unknown) => ({ ...rentBody, template });
const templateOf = (template: unknown) => unwrap(recurrenceFromBody(parsed(withTemplate(template)))).template;

describe("the recurrence definition on the wire (HU-E4-11)", () => {
  it("reads the Rent body as DefineRecurrence input: the fund pays, no split, no end", () => {
    expect(unwrap(recurrenceFromBody(parsed(rentBody)))).toEqual({
      description: "Rent",
      amount: money(120_000_000n),
      template: {
        type: "EXPENSE",
        categoryId: "cat-rent",
        payer: { memberId: null, accountId: "acc-fund" },
        split: null,
      },
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: "2026-12-01",
      endDate: null,
    });
  });

  it("turns percentages into basis points and leaves a contribution's missing source null", () => {
    const split = {
      method: "PERCENT",
      participants: [
        { memberId: "member-ana", percent: "40" },
        { memberId: "member-juan", percent: "60" },
      ],
    };
    const expense = unwrap(
      recurrenceFromBody(parsed({ ...rentBody, template: { ...rentBody.template, split } })),
    );
    expect(expense.template).toMatchObject({
      split: {
        method: "PERCENT",
        participants: [
          { memberId: "member-ana", basisPoints: 4000 },
          { memberId: "member-juan", basisPoints: 6000 },
        ],
      },
    });
    const contribution = unwrap(
      recurrenceFromBody(
        parsed({
          ...rentBody,
          template: { type: "FUND_CONTRIBUTION", fundAccountId: "acc-fund", memberId: "member-pedro" },
        }),
      ),
    );
    expect(contribution.template).toEqual({
      type: "FUND_CONTRIBUTION",
      fundAccountId: "acc-fund",
      memberId: "member-pedro",
      sourceAccountId: null,
    });
  });

  it("refuses an EXACT split, an unknown type and fractional anchors, and leaves anchor ranges to the domain", () => {
    expect([
      accepts({
        ...rentBody,
        template: { ...rentBody.template, split: { method: "EXACT", participants: [] } },
      }),
      accepts({ ...rentBody, template: { type: "SETTLEMENT" } }),
      accepts({ ...rentBody, schedule: { kind: "MONTHLY", day: 1.5 } }),
      accepts({ ...rentBody, schedule: { kind: "MONTHLY", day: 0 } }),
      accepts({ ...rentBody, endDate: null }),
    ]).toEqual([false, false, false, true, true]);
  });

  it("answers InvalidDate for a date the kernel refuses", () => {
    expect(recurrenceFromBody(parsed({ ...rentBody, startDate: "1899-12-31" }))).toMatchObject({
      ok: false,
      error: { code: "InvalidDate" },
    });
  });

  it("refuses an EXACT split with its amounts too: the request never offers fixed amounts (ruling P23)", () => {
    const exact = {
      method: "EXACT",
      participants: [
        { memberId: "member-ana", amount: { amount: "48000000", currency: "COP" } },
        { memberId: "member-juan", amount: { amount: "72000000", currency: "COP" } },
      ],
    };
    const result = DefineRecurrenceBodySchema.safeParse(withTemplate({ ...rentBody.template, split: exact }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.every((issue) => issue.path.slice(0, 2).join(".") === "template.split")).toBe(
      true,
    );
  });

  it("reads equal and share-unit splits, and refuses numeric or over-precise percentages and fractional units", () => {
    const split = (body: unknown) =>
      (templateOf({ ...rentBody.template, split: body }) as { split: unknown }).split;
    expect(
      split({ method: "EQUAL", participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }] }),
    ).toEqual({
      method: "EQUAL",
      participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }],
    });
    expect(
      split({
        method: "SHARES",
        participants: [
          { memberId: "member-ana", units: 2 },
          { memberId: "member-juan", units: 3 },
        ],
      }),
    ).toEqual({
      method: "SHARES",
      participants: [
        { memberId: "member-ana", units: 2 },
        { memberId: "member-juan", units: 3 },
      ],
    });
    const percent = (value: unknown) =>
      accepts(
        withTemplate({
          ...rentBody.template,
          split: { method: "PERCENT", participants: [{ memberId: "member-ana", percent: value }] },
        }),
      );
    expect([percent("33.33"), percent(40), percent("40.555"), percent("-5")]).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(
      accepts(
        withTemplate({
          ...rentBody.template,
          split: { method: "SHARES", participants: [{ memberId: "member-ana", units: 1.5 }] },
        }),
      ),
    ).toBe(false);
  });

  it("reads each template type with exactly its own references", () => {
    expect(
      templateOf({ type: "EXPENSE", categoryId: "cat-internet", payer: { memberId: "member-pedro" } }),
    ).toStrictEqual({
      type: "EXPENSE",
      categoryId: "cat-internet",
      payer: { memberId: "member-pedro", accountId: null },
      split: null,
    });
    expect(templateOf({ type: "INCOME", categoryId: "cat-salary", accountId: "acc-ana" })).toStrictEqual({
      type: "INCOME",
      categoryId: "cat-salary",
      accountId: "acc-ana",
    });
    expect(
      templateOf({ type: "TRANSFER", sourceAccountId: "acc-ana", destinationAccountId: "acc-savings" }),
    ).toStrictEqual({ type: "TRANSFER", sourceAccountId: "acc-ana", destinationAccountId: "acc-savings" });
    expect(
      templateOf({
        type: "FUND_CONTRIBUTION",
        fundAccountId: "acc-fund",
        memberId: "member-ana",
        sourceAccountId: "acc-ana",
      }),
    ).toStrictEqual({
      type: "FUND_CONTRIBUTION",
      fundAccountId: "acc-fund",
      memberId: "member-ana",
      sourceAccountId: "acc-ana",
    });
    // A guest pays outside the app: an explicit null account is the same as none.
    expect(
      templateOf({
        type: "EXPENSE",
        categoryId: "cat-internet",
        payer: { memberId: "member-pedro", accountId: null },
      }),
    ).toStrictEqual({
      type: "EXPENSE",
      categoryId: "cat-internet",
      payer: { memberId: "member-pedro", accountId: null },
      split: null,
    });
  });

  it("reads a missing or null split as the default split of each occurrence (spec 5.3, ruling P23)", () => {
    const split = (body: object) =>
      (templateOf({ ...rentBody.template, ...body }) as { split: unknown }).split;
    expect([split({}), split({ split: null })]).toEqual([null, null]);
  });

  it("leaves a contribution's member to the requester when the body sends none or null (HU-E4-09)", () => {
    const contribution = (body: object) =>
      templateOf({ type: "FUND_CONTRIBUTION", fundAccountId: "acc-fund", ...body }) as {
        memberId?: string;
        sourceAccountId: string | null;
      };
    expect([contribution({}).memberId, contribution({ memberId: null }).memberId]).toEqual([
      undefined,
      undefined,
    ]);
    expect(contribution({ memberId: "member-ana" }).memberId).toBe("member-ana");
    expect([
      contribution({}).sourceAccountId,
      contribution({ sourceAccountId: null }).sourceAccountId,
    ]).toEqual([null, null]);
  });

  it("reads a SEMI_MONTHLY schedule as sent and leaves out-of-range anchors to the domain", () => {
    const schedule = (value: unknown) => recurrenceFromBody(parsed({ ...rentBody, schedule: value }));
    expect(unwrap(schedule({ kind: "SEMI_MONTHLY", day1: 1, day2: 16 })).schedule).toStrictEqual({
      kind: "SEMI_MONTHLY",
      day1: 1,
      day2: 16,
    });
    expect(unwrap(schedule({ kind: "SEMI_MONTHLY", day1: 0, day2: 40 })).schedule).toStrictEqual({
      kind: "SEMI_MONTHLY",
      day1: 0,
      day2: 40,
    });
    expect([
      accepts({ ...rentBody, schedule: { kind: "SEMI_MONTHLY", day1: 1 } }),
      accepts({ ...rentBody, schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 15.5 } }),
      accepts({ ...rentBody, schedule: { kind: "WEEKLY", day: 1 } }),
    ]).toEqual([false, false, false]);
  });

  it("refuses a template that lacks a reference of its own type", () => {
    expect([
      accepts(withTemplate({ type: "EXPENSE", payer: { memberId: null } })),
      accepts(withTemplate({ type: "EXPENSE", categoryId: "cat-rent" })),
      accepts(withTemplate({ type: "INCOME", categoryId: "cat-salary" })),
      accepts(withTemplate({ type: "INCOME", accountId: "acc-ana" })),
      accepts(withTemplate({ type: "TRANSFER", accountId: "acc-ana" })),
      accepts(withTemplate({ type: "TRANSFER", sourceAccountId: "acc-ana" })),
      accepts(withTemplate({ type: "FUND_CONTRIBUTION", accountId: "acc-fund" })),
      accepts({ ...rentBody, template: undefined }),
    ]).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("drops a reference that belongs to another type: the body's Zod objects strip it and nothing reads it", () => {
    const foreign = {
      categoryId: "cat-intruder",
      accountId: "acc-intruder",
      sourceAccountId: "acc-intruder-source",
      destinationAccountId: "acc-intruder-destination",
      fundAccountId: "acc-intruder-fund",
      payer: { memberId: "member-intruder", accountId: "acc-intruder" },
      split: { method: "EQUAL", participants: [{ memberId: "member-intruder" }] },
      memberId: "member-intruder",
    };
    const without = (...keys: string[]) =>
      Object.fromEntries(Object.entries(foreign).filter(([key]) => !keys.includes(key)));

    expect(
      templateOf({
        type: "TRANSFER",
        sourceAccountId: "acc-ana",
        destinationAccountId: "acc-savings",
        ...without("sourceAccountId", "destinationAccountId"),
      }),
    ).toStrictEqual({ type: "TRANSFER", sourceAccountId: "acc-ana", destinationAccountId: "acc-savings" });
    expect(
      templateOf({
        type: "INCOME",
        categoryId: "cat-salary",
        accountId: "acc-ana",
        ...without("categoryId", "accountId"),
      }),
    ).toStrictEqual({
      type: "INCOME",
      categoryId: "cat-salary",
      accountId: "acc-ana",
    });
    expect(
      templateOf({
        type: "EXPENSE",
        categoryId: "cat-internet",
        payer: { memberId: "member-ana" },
        ...without("categoryId", "payer", "split"),
      }),
    ).toStrictEqual({
      type: "EXPENSE",
      categoryId: "cat-internet",
      payer: { memberId: "member-ana", accountId: null },
      split: null,
    });
    expect(
      templateOf({
        type: "FUND_CONTRIBUTION",
        fundAccountId: "acc-fund",
        memberId: "member-ana",
        ...without("fundAccountId", "memberId", "sourceAccountId"),
      }),
    ).toStrictEqual({
      type: "FUND_CONTRIBUTION",
      fundAccountId: "acc-fund",
      memberId: "member-ana",
      sourceAccountId: null,
    });

    const body = parsed({ ...rentBody, spaceId: "space-other", userId: "user-other" });
    expect(Object.keys(unwrap(recurrenceFromBody(body))).sort()).toEqual(
      ["amount", "description", "endDate", "mode", "schedule", "startDate", "template"].sort(),
    );
  });

  it("reads an end date, and answers InvalidDate for an end date the kernel refuses", () => {
    expect(unwrap(recurrenceFromBody(parsed({ ...rentBody, endDate: "2027-12-01" }))).endDate).toBe(
      "2027-12-01",
    );
    expect(recurrenceFromBody(parsed({ ...rentBody, endDate: "1899-12-31" }))).toMatchObject({
      ok: false,
      error: { code: "InvalidDate" },
    });
  });

  it("keeps money a string of minor units and refuses a mode that is not AUTO or CONFIRM", () => {
    expect([
      accepts({ ...rentBody, amount: { amount: 120000000, currency: "COP" } }),
      accepts({ ...rentBody, amount: { amount: "1200000.50", currency: "COP" } }),
      accepts({ ...rentBody, mode: "MANUAL" }),
      accepts({ ...rentBody, mode: "CONFIRM" }),
    ]).toEqual([false, false, false, true]);
  });
});
