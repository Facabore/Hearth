import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import type { LocalDate } from "@/shared/kernel";
import { startTestApp } from "../support/app";
import { activatePlan, closePlan, newPlan } from "../support/budgeting";
import { MovableClock } from "../support/in-memory-recurrences";
import { cop, type TransactionDto } from "../support/ledger";
import {
  homePlan,
  householdWithFund,
  patchRecurrence,
  recurrenceOf,
  rentBody,
  trackedRecurrences,
  transactionsIn,
  type HouseholdWithFund,
} from "../support/recurrences";

let app: Container;
/** The definition day, 2026-10-28 at noon in Bogota; a test that closes a plan moves it past the period (P17 amended). */
const clock = new MovableClock("2026-10-28");
beforeAll(() => {
  app = startTestApp({ clock });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * The job handles every active recurrence of the database, so each test ends its own after it ran, logically (D8): a
 * later run, of this file or of another, must not find one of them due.
 */
const recurrences = trackedRecurrences();
const { define } = recurrences;
afterEach(async () => {
  clock.set("2026-10-28");
  await recurrences.endAll();
});

/**
 * The job the in-container timer runs, on `today`; no endpoint triggers it (ruling P20). It handles every active
 * recurrence of the database, those of earlier tests included, so what it returns is what it did to the running test's
 * recurrences, and none of them failed or paused.
 */
const schedulerRunsOn = async (today: string) => {
  const report = await app.ledger.materializeDueOccurrences({ today: today as LocalDate });
  const mine = new Set(recurrences.ids());
  const ofMine = <T extends { recurrenceId: string }>(items: readonly T[]) =>
    items.filter((item) => mine.has(item.recurrenceId));
  expect([ofMine(report.failures), ofMine(report.paused)]).toEqual([[], []]);
  return { occurrences: ofMine(report.occurrences) };
};
const expensesIn = async (h: HouseholdWithFund, period: string) =>
  (await transactionsIn(h.ana, h.spaceId, period)).filter((t) => t.type === "EXPENSE");
const sharesOf = (tx: TransactionDto) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

describe("recording due occurrences (HU-E4-12)", () => {
  it("records the 2026-12-01 Rent from the fund on schedule, linked to its recurrence (@critical)", async () => {
    const h = await householdWithFund();
    const rent = await define(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2026-12-01");
    const expenses = await expensesIn(h, "2026-12");
    expect(expenses.map((t) => [t.description, t.date, t.amount, t.payments, t.createdBy])).toEqual([
      [
        "Rent",
        "2026-12-01",
        cop(1_200_000),
        [{ memberId: null, accountId: h.fund, amount: cop(1_200_000) }],
        h.ana.userId,
      ],
    ]);
    expect((await recurrenceOf(h.ana, h.spaceId, rent.id)).lastOccurrence).toMatchObject({
      date: "2026-12-01",
      status: "RECORDED",
      transactionId: expenses[0]!.id,
    });
  });

  it("records exactly one Rent for 2026-12-01 when the scheduler runs twice that day", async () => {
    const h = await householdWithFund();
    await define(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2026-12-01");
    await schedulerRunsOn("2026-12-01");
    expect((await expensesIn(h, "2026-12")).map((t) => t.date)).toEqual(["2026-12-01"]);
  });

  it("catches up the 2026-12-01 Rent when the scheduler first runs on 2026-12-04", async () => {
    const h = await householdWithFund();
    await define(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2026-12-04");
    expect((await expensesIn(h, "2026-12")).map((t) => [t.description, t.date])).toEqual([
      ["Rent", "2026-12-01"],
    ]);
  });

  it("splits Internet BY_ALLOCATION with the plan of each occurrence's period: 48,000 / 72,000 then 60,000 / 60,000 COP (@golden)", async () => {
    const h = await householdWithFund();
    await homePlan(h, "2026-12");
    await homePlan(h, "2027-01", ["50", "50"]);
    await define(h.juan, h.spaceId, {
      description: "Internet",
      amount: cop(120_000),
      template: {
        type: "EXPENSE",
        categoryId: h.utilities,
        payer: { memberId: h.juan.memberId, accountId: h.juan.account },
      },
      schedule: { kind: "MONTHLY", day: 5 },
      mode: "AUTO",
      startDate: "2026-12-01",
    });
    await schedulerRunsOn("2027-01-05");
    const expenses = [...(await expensesIn(h, "2026-12")), ...(await expensesIn(h, "2027-01"))];
    expect(expenses.map((t) => [t.date, t.amount, t.createdBy, sharesOf(t)])).toEqual([
      [
        "2026-12-05",
        cop(120_000),
        h.juan.userId,
        [
          [h.ana.memberId, cop(48_000), "BY_ALLOCATION"],
          [h.juan.memberId, cop(72_000), "BY_ALLOCATION"],
        ],
      ],
      [
        "2027-01-05",
        cop(120_000),
        h.juan.userId,
        [
          [h.ana.memberId, cop(60_000), "BY_ALLOCATION"],
          [h.juan.memberId, cop(60_000), "BY_ALLOCATION"],
        ],
      ],
    ]);
  });

  it("skips, on a catch-up run, the occurrence of a period whose plan was CLOSED after it ended: PeriodClosed (P25)", async () => {
    const h = await householdWithFund();
    const rent = await define(h.ana, h.spaceId, rentBody(h));
    const { id: december } = await newPlan(h.ana, h.spaceId, "2026-12");
    expect((await activatePlan(h.ana, h.spaceId, december)).status).toBe(200);
    // The job was down through December, and the plan closes only once its period has ended (P17 amended).
    clock.set("2027-01-02");
    expect((await closePlan(h.ana, h.spaceId, december)).status).toBe(200);
    const run = await schedulerRunsOn("2027-01-02");
    expect(await expensesIn(h, "2026-12")).toEqual([]);
    expect(run.occurrences.map((o) => [o.date, o.status, o.reason])).toEqual([
      ["2026-12-01", "SKIPPED", "PeriodClosed"],
      ["2027-01-01", "RECORDED", null],
    ]);
    expect((await expensesIn(h, "2027-01")).map((t) => [t.description, t.date])).toEqual([
      ["Rent", "2027-01-01"],
    ]);
    const read = await recurrenceOf(h.ana, h.spaceId, rent.id);
    expect([read.status, read.nextOccurrence]).toEqual(["ACTIVE", "2027-02-01"]);
  });

  it("records nothing for 2027-02-01, after the Rent's end date, and the Rent is ENDED", async () => {
    const h = await householdWithFund();
    const rent = await define(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2027-02-01");
    expect([
      (await expensesIn(h, "2027-01")).map((t) => t.date),
      await expensesIn(h, "2027-02"),
      (await recurrenceOf(h.ana, h.spaceId, rent.id)).status,
    ]).toEqual([["2027-01-01"], [], "ENDED"]);
  });

  it("applies an edit to future occurrences only: 2026-12-01 keeps 1,200,000 COP, 2027-01-01 records 1,300,000 COP", async () => {
    const h = await householdWithFund();
    const rent = await define(h.ana, h.spaceId, rentBody(h));
    await schedulerRunsOn("2026-12-01");
    clock.set("2026-12-15");
    expect((await patchRecurrence(h.ana, h.spaceId, rent.id, { amount: cop(1_300_000) })).status).toBe(200);
    await schedulerRunsOn("2027-01-01");
    const expenses = [...(await expensesIn(h, "2026-12")), ...(await expensesIn(h, "2027-01"))];
    expect(expenses.map((t) => [t.date, t.amount])).toEqual([
      ["2026-12-01", cop(1_200_000)],
      ["2027-01-01", cop(1_300_000)],
    ]);
  });

  it("never back-dates nor charges December twice when the Rent moves to the 15th on 2026-12-20: next on 2027-01-15 (final review I1)", async () => {
    const h = await householdWithFund();
    const rent = await define(h.ana, h.spaceId, rentBody(h));
    await schedulerRunsOn("2026-12-01");
    clock.set("2026-12-20");
    const moved = { schedule: { kind: "MONTHLY", day: 15 } };
    expect((await patchRecurrence(h.ana, h.spaceId, rent.id, moved)).status).toBe(200);
    await schedulerRunsOn("2026-12-20");
    await schedulerRunsOn("2027-01-14");
    expect([
      (await expensesIn(h, "2026-12")).map((t) => t.date),
      await expensesIn(h, "2027-01"),
      (await recurrenceOf(h.ana, h.spaceId, rent.id)).nextOccurrence,
    ]).toEqual([["2026-12-01"], [], "2027-01-15"]);
    await schedulerRunsOn("2027-01-15");
    expect((await expensesIn(h, "2027-01")).map((t) => [t.description, t.date, t.amount])).toEqual([
      ["Rent", "2027-01-15", cop(1_200_000)],
    ]);
  });
});
