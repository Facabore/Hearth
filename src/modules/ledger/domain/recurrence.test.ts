import { describe, expect, expectTypeOf, it } from "vitest";
import type { LocalDate, Result } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  MAX_UPCOMING,
  blockerOf,
  debitsPersonalAccount,
  defineRecurrence,
  endedRecurrence,
  payerOf,
  pausedRecurrence,
  resumedRecurrence,
  revisedRecurrence,
  statusOf,
  upcomingDates,
  type NewRecurrence,
  type Recurrence,
  type RecurrenceChanges,
  type RecurrenceId,
  type RecurrenceSplit,
  type RecurrenceTemplate,
} from "./recurrence";

const day = (iso: string) => iso as LocalDate;
/** Noon of `iso` in Bogotá. */
const at = (iso: string) => new Date(`${iso}T17:00:00Z`);
const RENT: RecurrenceTemplate = {
  type: "EXPENSE",
  categoryId: "cat-rent",
  payer: { memberId: null, accountId: "acc-household-fund" },
  split: null,
};
/** HU-E4-11: "Rent", 1,200,000 COP from the Household Fund, MONTHLY(1), AUTO, from 2026-12-01, defined on 2026-10-28. */
const definition = (overrides: Partial<NewRecurrence> = {}): NewRecurrence => ({
  id: "rec-rent" as RecurrenceId,
  spaceId: "space-household",
  description: "Rent",
  amount: 120_000_000n,
  currency: "COP",
  template: RENT,
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: day("2026-12-01"),
  endDate: null,
  createdBy: "u-ana",
  now: at("2026-10-28"),
  today: day("2026-10-28"),
  ...overrides,
});
const rent = (overrides: Partial<NewRecurrence> = {}): Recurrence =>
  unwrap(defineRecurrence(definition(overrides)));
/** What defining the Rent with these overrides answers: "ok" or the error code. */
const define = (overrides: Partial<NewRecurrence>) => codeOf(defineRecurrence(definition(overrides)));

describe("defining a recurrence (HU-E4-11)", () => {
  it("is ACTIVE and next occurs on its start date, 2026-12-01", () => {
    const r = rent();
    expect([statusOf(r), upcomingDates(r, 1), r.dueFrom, r.pausedAt, r.endedAt]).toEqual([
      "ACTIVE",
      ["2026-12-01"],
      "2026-12-01",
      null,
      null,
    ]);
  });

  it("never back-fills days before it was defined: a past start is due from the definition day (P24)", () => {
    const r = rent({ startDate: day("2026-10-01") });
    expect([r.dueFrom, upcomingDates(r, 2)]).toEqual(["2026-10-28", ["2026-11-01", "2026-12-01"]]);
  });

  it("is due on the definition day itself when it starts then, and records that day's date (P24)", () => {
    const r = rent({ schedule: { kind: "MONTHLY", day: 28 }, startDate: day("2026-10-28") });
    expect([r.dueFrom, upcomingDates(r, 2)]).toEqual(["2026-10-28", ["2026-10-28", "2026-11-28"]]);
  });

  it("is due from the start date when it starts the day after its definition (P24)", () => {
    const r = rent({ schedule: { kind: "MONTHLY", day: 29 }, startDate: day("2026-10-29") });
    expect([r.dueFrom, upcomingDates(r, 1)]).toEqual(["2026-10-29", ["2026-10-29"]]);
  });

  it("keeps what was defined and stamps it with the definition time", () => {
    expect(rent({ description: "  Rent  ", mode: "CONFIRM", endDate: day("2027-06-01") })).toEqual({
      id: "rec-rent",
      spaceId: "space-household",
      description: "Rent",
      amount: 120_000_000n,
      currency: "COP",
      template: RENT,
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "CONFIRM",
      startDate: "2026-12-01",
      endDate: "2027-06-01",
      dueFrom: "2026-12-01",
      pausedAt: null,
      pauseReason: null,
      endedAt: null,
      createdBy: "u-ana",
      createdAt: at("2026-10-28"),
      updatedAt: at("2026-10-28"),
    });
  });

  it("refuses a non-positive amount, an empty or long description and an end before its start", () => {
    expect([
      define({ amount: 0n }),
      define({ description: "   " }),
      define({ description: "x".repeat(201) }),
      define({ endDate: day("2026-11-30") }),
      define({ endDate: day("2026-12-01") }),
    ]).toEqual(["InvalidAmount", "InvalidDescription", "InvalidDescription", "InvalidRecurrence", "ok"]);
  });

  it("refuses a negative amount and accepts one minor unit", () => {
    expect([define({ amount: -1n }), define({ amount: 1n })]).toEqual(["InvalidAmount", "ok"]);
  });

  it("measures the description trimmed: 1 to 200 characters", () => {
    expect([
      define({ description: "" }),
      define({ description: "x" }),
      define({ description: "x".repeat(200) }),
      define({ description: `  ${"x".repeat(200)}  ` }),
      define({ description: ` ${"x".repeat(201)} ` }),
    ]).toEqual(["InvalidDescription", "ok", "ok", "ok", "InvalidDescription"]);
  });

  it("ends once no schedule date is left up to its end date, the end date included", () => {
    const r = rent({ endDate: day("2027-01-01") });
    expect([statusOf(r), upcomingDates(r, 5)]).toEqual(["ACTIVE", ["2026-12-01", "2027-01-01"]]);
    expect(statusOf({ ...r, dueFrom: day("2027-01-02") })).toBe("ENDED");
  });

  it("refuses a definition that could never record anything: no schedule date from its first due date to its end", () => {
    expect([
      // A past start whose end date passed before the definition day.
      define({ startDate: day("2026-10-01"), endDate: day("2026-10-15") }),
      // The end date is the definition day but the next MONTHLY(1) date, 2026-11-01, comes after it.
      define({ startDate: day("2026-10-01"), endDate: day("2026-10-28") }),
      // MONTHLY(1) from 2026-12-02 to 2026-12-20: the next date, 2027-01-01, comes after the end.
      define({ startDate: day("2026-12-02"), endDate: day("2026-12-20") }),
    ]).toEqual(["InvalidRecurrence", "InvalidRecurrence", "InvalidRecurrence"]);
  });

  it("accepts an end date that is the first schedule date left, the end date included", () => {
    const monthly28 = { kind: "MONTHLY", day: 28 } as const;
    expect([
      define({ startDate: day("2026-10-01"), endDate: day("2026-11-01") }),
      define({ startDate: day("2026-12-02"), endDate: day("2027-01-01") }),
      define({ schedule: monthly28, startDate: day("2026-10-01"), endDate: day("2026-10-28") }),
    ]).toEqual(["ok", "ok", "ok"]);
  });

  it("lists no date while paused or ended", () => {
    const r = rent();
    expect([
      [
        statusOf({ ...r, pausedAt: at("2026-11-01") }),
        upcomingDates({ ...r, pausedAt: at("2026-11-01") }, 1),
      ],
      [statusOf({ ...r, endedAt: at("2026-11-01") }), upcomingDates({ ...r, endedAt: at("2026-11-01") }, 1)],
    ]).toEqual([
      ["PAUSED", []],
      ["ENDED", []],
    ]);
  });
});

describe("the status of a recurrence (HU-E4-11)", () => {
  const paused = at("2026-11-01");
  const ended = at("2026-11-02");

  it("is ACTIVE, PAUSED while paused and ENDED once ended, which wins over a pause", () => {
    const r = rent();
    expect([
      statusOf(r),
      statusOf({ ...r, pausedAt: paused }),
      statusOf({ ...r, endedAt: ended }),
      statusOf({ ...r, pausedAt: paused, endedAt: ended }),
    ]).toEqual(["ACTIVE", "PAUSED", "ENDED", "ENDED"]);
  });

  it("stays ACTIVE with one schedule date left on the end date, and ends the day after it", () => {
    const r = rent({ endDate: day("2027-01-01") });
    expect([
      statusOf({ ...r, dueFrom: day("2026-12-02") }),
      statusOf({ ...r, dueFrom: day("2027-01-01") }),
      statusOf({ ...r, dueFrom: day("2027-01-02") }),
    ]).toEqual(["ACTIVE", "ACTIVE", "ENDED"]);
  });

  it("ends when the end date falls between schedule dates and none is left before it", () => {
    const r = rent({ endDate: day("2027-01-15") });
    expect([
      statusOf({ ...r, dueFrom: day("2027-01-01") }),
      statusOf({ ...r, dueFrom: day("2027-01-02") }),
      statusOf({ ...r, dueFrom: day("2027-01-15") }),
    ]).toEqual(["ACTIVE", "ENDED", "ENDED"]);
  });

  it("is ACTIVE without an end date however far its next date lies", () => {
    expect(statusOf({ ...rent(), dueFrom: day("2040-01-02") })).toBe("ACTIVE");
  });

  it("is ENDED, not PAUSED, when it is paused with no schedule date left", () => {
    const r = { ...rent({ endDate: day("2027-01-01") }), dueFrom: day("2027-01-02"), pausedAt: paused };
    expect(statusOf(r)).toBe("ENDED");
  });
});

describe("the upcoming dates of a recurrence (HU-E4-11)", () => {
  it("lists nothing while paused, once ended, or once its end date has passed", () => {
    const r = rent({ endDate: day("2027-01-01") });
    expect([
      upcomingDates({ ...r, pausedAt: at("2026-11-01") }, 5),
      upcomingDates({ ...r, endedAt: at("2026-11-02") }, 5),
      upcomingDates({ ...r, pausedAt: at("2026-11-01"), endedAt: at("2026-11-02") }, 5),
      upcomingDates({ ...r, dueFrom: day("2027-01-02") }, 5),
    ]).toEqual([[], [], [], []]);
  });

  it("starts at the first date not considered yet, not at the start date", () => {
    expect(upcomingDates({ ...rent(), dueFrom: day("2027-03-02") }, 2)).toEqual(["2027-04-01", "2027-05-01"]);
  });

  it("lists as many dates as asked up to its end date, and none for a count of zero", () => {
    const r = rent({ endDate: day("2027-02-15") });
    expect([upcomingDates(r, 2), upcomingDates(r, MAX_UPCOMING), upcomingDates(r, 0)]).toEqual([
      ["2026-12-01", "2027-01-01"],
      ["2026-12-01", "2027-01-01", "2027-02-01"],
      [],
    ]);
  });

  it("previews at most MAX_UPCOMING = 24 dates of an endless recurrence: two years of Rent", () => {
    const dates = upcomingDates(rent(), MAX_UPCOMING);
    expect([MAX_UPCOMING, dates.length, dates[0], dates[23]]).toEqual([24, 24, "2026-12-01", "2028-11-01"]);
  });
});

describe("editing a recurrence (HU-E4-11, P22)", () => {
  const half: RecurrenceSplit = {
    method: "PERCENT",
    participants: [
      { memberId: "member-ana", basisPoints: 5000 },
      { memberId: "member-juan", basisPoints: 5000 },
    ],
  };
  const paused = at("2026-11-01");
  const ended = at("2026-11-02");

  it("changes what the next occurrences record: Rent at 1,300,000 COP", () => {
    const original = rent();
    const edited = unwrap(
      revisedRecurrence(original, { amount: 130_000_000n, description: "Rent 2027" }, at("2026-12-15")),
    );
    expect([edited.amount, edited.description, edited.updatedAt, edited.dueFrom]).toEqual([
      130_000_000n,
      "Rent 2027",
      at("2026-12-15"),
      "2026-12-01",
    ]);
    expect([original.amount, original.description, original.updatedAt]).toEqual([
      120_000_000n,
      "Rent",
      at("2026-10-28"),
    ]);
  });

  it("changes nothing but what the edit names: dates, state and authorship stay", () => {
    const current: Recurrence = { ...rent(), pausedAt: paused, pauseReason: "PayerLeft" };
    const edited = unwrap(revisedRecurrence(current, { mode: "CONFIRM" }, at("2026-11-03")));
    expect(edited).toEqual({ ...current, mode: "CONFIRM", updatedAt: at("2026-11-03") });
    expect(statusOf(edited)).toBe("PAUSED");
  });

  it("changes the category of expenses and incomes only, and the split of expenses only", () => {
    const transfer = rent({
      template: { type: "TRANSFER", sourceAccountId: "acc-bancolombia", destinationAccountId: "acc-nequi" },
    });
    const salary = rent({
      template: { type: "INCOME", categoryId: "cat-salary", accountId: "acc-bancolombia" },
    });
    expect([
      codeOf(revisedRecurrence(transfer, { categoryId: "cat-other" }, at("2026-11-01"))),
      codeOf(revisedRecurrence(salary, { split: half }, at("2026-11-01"))),
      codeOf(revisedRecurrence(salary, { categoryId: "cat-bonus" }, at("2026-11-01"))),
    ]).toEqual(["InvalidRecurrence", "InvalidRecurrence", "ok"]);
    const split = unwrap(revisedRecurrence(rent(), { split: half }, at("2026-11-01")));
    expect(split.template).toEqual({ ...RENT, split: half });
    expect(unwrap(revisedRecurrence(split, { split: null }, at("2026-11-02"))).template).toEqual(RENT);
  });

  it("refuses a category or a split on a transfer or a contribution, and a split on an income", () => {
    const transfer = rent({
      template: { type: "TRANSFER", sourceAccountId: "acc-bancolombia", destinationAccountId: "acc-nequi" },
    });
    const contribution = rent({
      template: {
        type: "FUND_CONTRIBUTION",
        fundAccountId: "acc-household-fund",
        memberId: "member-ana",
        sourceAccountId: "acc-bancolombia",
      },
    });
    const now = at("2026-11-01");
    expect([
      codeOf(revisedRecurrence(transfer, { split: half }, now)),
      codeOf(revisedRecurrence(transfer, { split: null }, now)),
      codeOf(revisedRecurrence(contribution, { categoryId: "cat-other" }, now)),
      codeOf(revisedRecurrence(contribution, { split: half }, now)),
    ]).toEqual(["InvalidRecurrence", "InvalidRecurrence", "InvalidRecurrence", "InvalidRecurrence"]);
  });

  it("changes the category of an income and of an expense, keeping the rest of the template", () => {
    const salary: RecurrenceTemplate = {
      type: "INCOME",
      categoryId: "cat-salary",
      accountId: "acc-bancolombia",
    };
    const now = at("2026-11-01");
    expect([
      unwrap(revisedRecurrence(rent({ template: salary }), { categoryId: "cat-bonus" }, now)).template,
      unwrap(revisedRecurrence(rent(), { categoryId: "cat-utilities", split: half }, now)).template,
    ]).toEqual([
      { type: "INCOME", categoryId: "cat-bonus", accountId: "acc-bancolombia" },
      { ...RENT, categoryId: "cat-utilities", split: half },
    ]);
  });

  it("shares by ratios only (P23): the split of a recurrence is never EXACT", () => {
    expectTypeOf<RecurrenceSplit["method"]>().toEqualTypeOf<"EQUAL" | "PERCENT" | "SHARES">();
    expectTypeOf<RecurrenceTemplate & { readonly type: "EXPENSE" }>()
      .toHaveProperty("split")
      .toEqualTypeOf<RecurrenceSplit | null>();
    const ratios: RecurrenceSplit[] = [
      { method: "EQUAL", participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }] },
      half,
      {
        method: "SHARES",
        participants: [
          { memberId: "member-ana", units: 2 },
          { memberId: "member-juan", units: 1 },
        ],
      },
    ];
    expect(
      ratios.map((split) => unwrap(revisedRecurrence(rent(), { split }, at("2026-11-01"))).template),
    ).toEqual(ratios.map((split) => ({ ...RENT, split })));
  });

  it("returns to the default split with null and keeps the split when the edit does not name it (P23)", () => {
    const shared = unwrap(revisedRecurrence(rent(), { split: half }, at("2026-11-01")));
    expect([
      unwrap(revisedRecurrence(shared, { amount: 1n }, at("2026-11-02"))).template,
      unwrap(revisedRecurrence(shared, { split: null }, at("2026-11-02"))).template,
    ]).toEqual([{ ...RENT, split: half }, RENT]);
  });

  it("keeps the type, payer and accounts as defined: an edit has no field for them (P22)", () => {
    expectTypeOf<keyof RecurrenceChanges>().toEqualTypeOf<
      "description" | "amount" | "categoryId" | "split" | "schedule" | "mode" | "endDate"
    >();
    const templates: RecurrenceTemplate[] = [
      {
        type: "EXPENSE",
        categoryId: "cat-utilities",
        payer: { memberId: "member-juan", accountId: "acc-davivienda" },
        split: null,
      },
      { type: "INCOME", categoryId: "cat-salary", accountId: "acc-bancolombia" },
      { type: "TRANSFER", sourceAccountId: "acc-bancolombia", destinationAccountId: "acc-nequi" },
      {
        type: "FUND_CONTRIBUTION",
        fundAccountId: "acc-household-fund",
        memberId: "member-ana",
        sourceAccountId: "acc-bancolombia",
      },
    ];
    // What a caller could smuggle in past the types: the template ignores it and only the amount changes.
    const smuggled = {
      amount: 1n,
      type: "TRANSFER",
      payer: { memberId: null, accountId: "acc-household-fund" },
      accountId: "acc-nequi",
      sourceAccountId: "acc-nequi",
      destinationAccountId: "acc-davivienda",
      fundAccountId: "acc-other",
      memberId: "member-juan",
    } as RecurrenceChanges;
    const edited = templates.map((template) =>
      unwrap(revisedRecurrence(rent({ template }), smuggled, at("2026-11-01"))),
    );
    expect([edited.map((r) => r.template), edited.map((r) => r.amount)]).toEqual([
      templates,
      [1n, 1n, 1n, 1n],
    ]);
  });

  it("validates the description and amount of an edit as when defining", () => {
    const edit = (changes: RecurrenceChanges) => codeOf(revisedRecurrence(rent(), changes, at("2026-11-01")));
    expect([
      edit({ description: "" }),
      edit({ description: "x".repeat(201) }),
      edit({ description: "x".repeat(200) }),
      edit({ amount: 0n }),
      edit({ amount: -1n }),
      edit({ amount: 1n }),
    ]).toEqual(["InvalidDescription", "InvalidDescription", "ok", "InvalidAmount", "InvalidAmount", "ok"]);
    expect(
      unwrap(revisedRecurrence(rent(), { description: "  Rent 2027  " }, at("2026-11-01"))).description,
    ).toBe("Rent 2027");
  });

  it("changes the schedule, mode and end date for the occurrences not recorded yet", () => {
    const edited = unwrap(
      revisedRecurrence(
        rent(),
        {
          schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 15 },
          mode: "CONFIRM",
          endDate: day("2026-12-15"),
        },
        at("2026-11-01"),
      ),
    );
    expect([edited.schedule, edited.mode, edited.endDate, upcomingDates(edited, 5)]).toEqual([
      { kind: "SEMI_MONTHLY", day1: 1, day2: 15 },
      "CONFIRM",
      "2026-12-15",
      ["2026-12-01", "2026-12-15"],
    ]);
  });

  it("removes the end date with null and keeps it when the edit does not name it", () => {
    const bounded = rent({ endDate: day("2027-01-01") });
    expect([
      unwrap(revisedRecurrence(bounded, { amount: 1n }, at("2026-11-01"))).endDate,
      unwrap(revisedRecurrence(bounded, { endDate: null }, at("2026-11-01"))).endDate,
    ]).toEqual(["2027-01-01", null]);
  });

  it("ends on the start date at the earliest: the day before it is refused, the start date itself is not", () => {
    const edit = (endDate: LocalDate) => codeOf(revisedRecurrence(rent(), { endDate }, at("2026-11-01")));
    expect([edit(day("2026-11-30")), edit(day("2026-12-01"))]).toEqual(["InvalidRecurrence", "ok"]);
  });

  it("validates the end date against the start date it keeps, not against the days already recorded", () => {
    const advanced = { ...rent(), dueFrom: day("2027-03-01") };
    const edited = unwrap(revisedRecurrence(advanced, { endDate: day("2027-01-01") }, at("2027-03-02")));
    expect([edited.endDate, statusOf(edited), upcomingDates(edited, 1)]).toEqual(["2027-01-01", "ENDED", []]);
  });

  it("refuses edits of an ended recurrence, end dates before the start and non-positive amounts", () => {
    const ended = { ...rent(), endedAt: at("2026-11-01") };
    expect([
      codeOf(revisedRecurrence(ended, { amount: 1n }, at("2026-11-02"))),
      codeOf(revisedRecurrence(rent(), { endDate: day("2026-11-01") }, at("2026-11-02"))),
      codeOf(revisedRecurrence(rent(), { amount: -1n }, at("2026-11-02"))),
    ]).toEqual(["RecurrenceEnded", "InvalidRecurrence", "InvalidAmount"]);
  });

  it("refuses every edit of an ended recurrence, paused or not, before looking at what it changes", () => {
    const now = at("2026-11-03");
    const stopped = { ...rent(), endedAt: ended };
    const stoppedWhilePaused = { ...stopped, pausedAt: paused };
    expect([
      codeOf(revisedRecurrence(stopped, {}, now)),
      codeOf(revisedRecurrence(stopped, { amount: -1n }, now)),
      codeOf(revisedRecurrence(stopped, { description: "" }, now)),
      codeOf(revisedRecurrence(stoppedWhilePaused, { mode: "CONFIRM" }, now)),
    ]).toEqual(["RecurrenceEnded", "RecurrenceEnded", "RecurrenceEnded", "RecurrenceEnded"]);
  });

  it("refuses every edit of a recurrence that ran out of dates, a later end date included: define a new one (P24)", () => {
    const now = at("2027-01-05");
    const exhausted = { ...rent({ endDate: day("2027-01-01") }), dueFrom: day("2027-01-02") };
    expect([
      statusOf(exhausted),
      codeOf(revisedRecurrence(exhausted, { endDate: day("2027-03-01") }, now)),
      codeOf(revisedRecurrence(exhausted, { endDate: null }, now)),
      codeOf(revisedRecurrence(exhausted, {}, now)),
      codeOf(revisedRecurrence(exhausted, { amount: -1n }, now)),
      codeOf(revisedRecurrence({ ...exhausted, pausedAt: paused }, { amount: 1n }, now)),
    ]).toEqual(["ENDED", ...Array.from({ length: 5 }, () => "RecurrenceEnded")]);
  });

  it("takes an edit while paused, and with one schedule date left on its end date", () => {
    const lastDate = { ...rent({ endDate: day("2027-01-01") }), dueFrom: day("2027-01-01") };
    expect([
      codeOf(revisedRecurrence({ ...rent(), pausedAt: paused }, { amount: 1n }, at("2026-11-03"))),
      statusOf(lastDate),
      codeOf(revisedRecurrence(lastDate, { amount: 1n }, at("2026-12-31"))),
    ]).toEqual(["ok", "ACTIVE", "ok"]);
  });
});

describe("pausing, resuming and ending (HU-E4-11)", () => {
  it("skips the paused span without back-filling: paused on 2026-12-20, resumed on 2027-02-10, next on 2027-02-16", () => {
    const cleaning = rent({ description: "Cleaning", schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    // A run already considered 2026-12-01 and 2026-12-16 (Task 8b moves dueFrom past them).
    const scheduled = { ...cleaning, dueFrom: day("2026-12-17") };
    const paused = unwrap(pausedRecurrence(scheduled, at("2026-12-20")));
    expect([statusOf(paused), upcomingDates(paused, 1), paused.pauseReason]).toEqual(["PAUSED", [], null]);
    const resumed = unwrap(resumedRecurrence(paused, at("2027-02-10"), day("2027-02-10")));
    expect([statusOf(resumed), upcomingDates(resumed, 2), resumed.pausedAt, resumed.dueFrom]).toEqual([
      "ACTIVE",
      ["2027-02-16", "2027-03-01"],
      null,
      "2027-02-10",
    ]);
  });

  it("keeps its first date when it resumes before that date is due, and records why it paused", () => {
    const paused = unwrap(pausedRecurrence(rent(), at("2026-10-29"), "PayerLeft"));
    expect(paused.pauseReason).toBe("PayerLeft");
    const resumed = unwrap(resumedRecurrence(paused, at("2026-11-02"), day("2026-11-02")));
    expect([upcomingDates(resumed, 1), resumed.pauseReason]).toEqual([["2026-12-01"], null]);
  });

  it("never moves dueFrom backwards: resuming before its start adds no date before the start (P24)", () => {
    const cleaning = rent({ description: "Cleaning", schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    const paused = unwrap(pausedRecurrence(cleaning, at("2026-10-29")));
    const resumed = unwrap(resumedRecurrence(paused, at("2026-11-02"), day("2026-11-02")));
    expect([resumed.dueFrom, upcomingDates(resumed, 2)]).toEqual([
      "2026-12-01",
      ["2026-12-01", "2026-12-16"],
    ]);
  });

  it("records the schedule date it resumes on, and resuming the day it paused changes no date (P24)", () => {
    const cleaning = rent({ description: "Cleaning", schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    const paused = unwrap(pausedRecurrence({ ...cleaning, dueFrom: day("2026-12-17") }, at("2026-12-20")));
    const onADate = unwrap(resumedRecurrence(paused, at("2027-02-16"), day("2027-02-16")));
    const sameDay = unwrap(resumedRecurrence(paused, at("2026-12-20"), day("2026-12-20")));
    expect([upcomingDates(onADate, 2), upcomingDates(sameDay, 2)]).toEqual([
      ["2027-02-16", "2027-03-01"],
      ["2027-01-01", "2027-01-16"],
    ]);
  });

  it("refuses to resume once its end date passed while it was paused, and a member can still end it (P24, P27)", () => {
    const bounded = rent({ endDate: day("2027-01-01") });
    const paused = unwrap(pausedRecurrence(bounded, at("2026-12-20"), "PayerLeft"));
    const resume = (iso: string) => resumedRecurrence(paused, at(iso), day(iso));
    const refusal = resume("2027-02-10");
    expect([codeOf(refusal), refusal.ok ? null : refusal.error.details]).toEqual([
      "InvalidRecurrenceTransition",
      { from: "PAUSED", to: "ACTIVE" },
    ]);
    // The end date is inclusive: resuming on it leaves one schedule date, the day after leaves none.
    expect([codeOf(resume("2027-01-01")), codeOf(resume("2027-01-02"))]).toEqual([
      "ok",
      "InvalidRecurrenceTransition",
    ]);
    const ended = unwrap(endedRecurrence(paused, at("2027-02-10")));
    expect([statusOf(paused), statusOf(ended), ended.endedAt, ended.pauseReason]).toEqual([
      "PAUSED",
      "ENDED",
      at("2027-02-10"),
      "PayerLeft",
    ]);
  });

  it("pauses an ACTIVE recurrence at that moment, with no reason when a member pauses it, and changes no date", () => {
    const active = rent();
    const paused = unwrap(pausedRecurrence(active, at("2026-11-05")));
    expect([paused.pausedAt, paused.pauseReason, paused.updatedAt, paused.dueFrom, paused.endedAt]).toEqual([
      at("2026-11-05"),
      null,
      at("2026-11-05"),
      "2026-12-01",
      null,
    ]);
    expect([statusOf(active), active.pausedAt, active.updatedAt]).toEqual(["ACTIVE", null, at("2026-10-28")]);
  });

  it("ends logically: it keeps its dates and any pause, lists no date and takes no edit (D8)", () => {
    const paused = unwrap(pausedRecurrence(rent(), at("2026-11-01"), "CreatorLeft"));
    const ended = unwrap(endedRecurrence(paused, at("2026-11-02")));
    expect(ended).toEqual({ ...paused, endedAt: at("2026-11-02"), updatedAt: at("2026-11-02") });
    expect([statusOf(ended), upcomingDates(ended, 1)]).toEqual(["ENDED", []]);
  });

  it("refuses moves from the wrong status with InvalidRecurrenceTransition", () => {
    const active = rent();
    const paused = unwrap(pausedRecurrence(active, at("2026-11-01")));
    const ended = unwrap(endedRecurrence(active, at("2026-11-01")));
    expect([
      codeOf(pausedRecurrence(paused, at("2026-11-02"))),
      codeOf(resumedRecurrence(active, at("2026-11-02"), day("2026-11-02"))),
      codeOf(endedRecurrence(ended, at("2026-11-02"))),
      codeOf(pausedRecurrence(ended, at("2026-11-02"))),
      codeOf(endedRecurrence(paused, at("2026-11-02"))),
    ]).toEqual([
      "InvalidRecurrenceTransition",
      "InvalidRecurrenceTransition",
      "InvalidRecurrenceTransition",
      "InvalidRecurrenceTransition",
      "ok",
    ]);
    expect([statusOf(ended), upcomingDates(ended, 1)]).toEqual(["ENDED", []]);
    expect(codeOf(revisedRecurrence(ended, { amount: 1n }, at("2026-11-02")))).toBe("RecurrenceEnded");
  });

  it("allows only ACTIVE to PAUSED, PAUSED to ACTIVE and a status that is not ENDED to ENDED (P27)", () => {
    const now = at("2027-01-05");
    const today = day("2027-01-05");
    const active = rent();
    const paused = { ...active, pausedAt: at("2026-11-01") };
    const ended = { ...active, endedAt: at("2026-11-01") };
    const endedWhilePaused = { ...paused, endedAt: at("2026-11-02") };
    // Ran out of dates: no schedule date is left up to its end date, so it is ENDED without ever being ended.
    const exhausted = { ...rent({ endDate: day("2027-01-01") }), dueFrom: day("2027-01-02") };
    const exhaustedWhilePaused = { ...exhausted, pausedAt: at("2026-11-01") };
    // Paused when its end date was still ahead; today it is past: still PAUSED, but resuming would leave it ENDED.
    const pausedPastItsEnd = { ...rent({ endDate: day("2027-01-01") }), pausedAt: at("2026-12-20") };
    const moves = (r: Recurrence) => [
      statusOf(r),
      codeOf(pausedRecurrence(r, now)),
      codeOf(resumedRecurrence(r, now, today)),
      codeOf(endedRecurrence(r, now)),
    ];
    const refused = "InvalidRecurrenceTransition";
    expect({
      active: moves(active),
      paused: moves(paused),
      ended: moves(ended),
      endedWhilePaused: moves(endedWhilePaused),
      exhausted: moves(exhausted),
      exhaustedWhilePaused: moves(exhaustedWhilePaused),
      pausedPastItsEnd: moves(pausedPastItsEnd),
    }).toEqual({
      active: ["ACTIVE", "ok", refused, "ok"],
      paused: ["PAUSED", refused, "ok", "ok"],
      ended: ["ENDED", refused, refused, refused],
      endedWhilePaused: ["ENDED", refused, refused, refused],
      exhausted: ["ENDED", refused, refused, refused],
      exhaustedWhilePaused: ["ENDED", refused, refused, refused],
      pausedPastItsEnd: ["PAUSED", refused, refused, "ok"],
    });
  });

  it("names the status it left and the one it was asked to move to", () => {
    const now = at("2026-11-02");
    const active = rent();
    const paused = unwrap(pausedRecurrence(active, at("2026-11-01")));
    const ended = unwrap(endedRecurrence(active, at("2026-11-01")));
    const details = (result: Result<Recurrence>) => (result.ok ? null : result.error.details);
    expect([
      details(pausedRecurrence(paused, now)),
      details(resumedRecurrence(active, now, day("2026-11-02"))),
      details(endedRecurrence(ended, now)),
      details(pausedRecurrence(ended, now)),
    ]).toEqual([
      { from: "PAUSED", to: "PAUSED" },
      { from: "ACTIVE", to: "ACTIVE" },
      { from: "ENDED", to: "ENDED" },
      { from: "ENDED", to: "PAUSED" },
    ]);
  });
});

describe("who a recurrence depends on (D9, P22, P26)", () => {
  const internet: RecurrenceTemplate = {
    type: "EXPENSE",
    categoryId: "cat-utilities",
    payer: { memberId: "member-juan", accountId: "acc-davivienda" },
    split: null,
  };
  const guestPays: RecurrenceTemplate = {
    type: "EXPENSE",
    categoryId: "cat-utilities",
    payer: { memberId: "member-pedro", accountId: null },
    split: null,
  };
  const contribution: RecurrenceTemplate = {
    type: "FUND_CONTRIBUTION",
    fundAccountId: "acc-household-fund",
    memberId: "member-ana",
    sourceAccountId: "acc-bancolombia",
  };
  const guestContributes: RecurrenceTemplate = {
    type: "FUND_CONTRIBUTION",
    fundAccountId: "acc-household-fund",
    memberId: "member-pedro",
    sourceAccountId: null,
  };
  const income: RecurrenceTemplate = {
    type: "INCOME",
    categoryId: "cat-salary",
    accountId: "acc-bancolombia",
  };
  const transfer: RecurrenceTemplate = {
    type: "TRANSFER",
    sourceAccountId: "acc-bancolombia",
    destinationAccountId: "acc-nequi",
  };
  const ana = { id: "member-ana", userId: "u-ana" };
  const juan = { id: "member-juan", userId: "u-juan" };
  /** Pedro is a guest: a member with no user. */
  const pedro = { id: "member-pedro", userId: null };

  it("debits a member's own account for member-paid expenses, contributions from an account and transfers", () => {
    expect(
      [RENT, internet, guestPays, contribution, guestContributes, income, transfer].map(
        debitsPersonalAccount,
      ),
    ).toEqual([false, true, false, true, false, false, true]);
  });

  it("is paid by the member an expense or a contribution names, and by nobody for the fund, an income or a transfer", () => {
    expect(
      [RENT, internet, guestPays, contribution, guestContributes, income, transfer].map(payerOf),
    ).toEqual([null, "member-juan", "member-pedro", "member-ana", "member-pedro", null, null]);
  });

  it("waits on its paying member first, then on its creator", () => {
    expect([
      blockerOf(rent({ template: internet }), [ana, juan]),
      blockerOf(rent({ template: internet }), [ana]),
      blockerOf(rent({ template: internet, createdBy: "u-juan" }), [ana]),
      blockerOf(rent(), [juan]),
      blockerOf(rent(), [ana]),
      blockerOf(rent({ template: guestContributes }), [ana]),
    ]).toEqual([null, "PayerLeft", "PayerLeft", "CreatorLeft", null, "PayerLeft"]);
  });

  it("is PayerLeft when the paying member left, however long the creator stays (Juan pays Internet and leaves)", () => {
    expect(blockerOf(rent({ template: internet }), [ana])).toBe("PayerLeft");
  });

  it("is PayerLeft when the guest who pays was removed, and blocks nothing while the guest stays", () => {
    const pedroPays = rent({ template: guestPays });
    expect([blockerOf(pedroPays, [ana]), blockerOf(pedroPays, [ana, pedro])]).toEqual(["PayerLeft", null]);
  });

  it("is CreatorLeft when its creator left and the paying member stays, a guest never standing in for them", () => {
    expect([
      blockerOf(rent({ template: internet }), [juan]),
      blockerOf(rent({ template: guestPays }), [pedro]),
      blockerOf(rent({ template: internet }), [juan, pedro]),
      blockerOf(rent({ template: internet, createdBy: "u-sofi" }), [ana, juan]),
    ]).toEqual(["CreatorLeft", "CreatorLeft", "CreatorLeft", "CreatorLeft"]);
  });

  it("is null while both the paying member and its creator are in the space", () => {
    expect([
      blockerOf(rent({ template: internet }), [ana, juan]),
      blockerOf(rent({ template: guestPays }), [ana, pedro]),
      blockerOf(rent({ template: contribution }), [ana]),
    ]).toEqual([null, null, null]);
  });

  it("names the paying member when both the payer and the creator left", () => {
    expect([
      blockerOf(rent({ template: internet }), []),
      blockerOf(rent({ template: internet, createdBy: "u-juan" }), [ana]),
    ]).toEqual(["PayerLeft", "PayerLeft"]);
  });

  it("depends on its creator alone when it has no paying member: the fund, an income or a transfer", () => {
    expect(
      [rent(), rent({ template: income }), rent({ template: transfer })].map((r) => [
        blockerOf(r, [ana]),
        blockerOf(r, [juan]),
        blockerOf(r, []),
      ]),
    ).toEqual(Array.from({ length: 3 }, () => [null, "CreatorLeft", "CreatorLeft"]));
  });
});
