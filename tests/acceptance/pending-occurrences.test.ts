import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import type { LocalDate } from "@/shared/kernel";
import { problemOf, startTestApp } from "../support/app";
import { lineNamed, planOf } from "../support/budgeting";
import { MovableClock } from "../support/in-memory-recurrences";
import { cop, joinHousehold } from "../support/ledger";
import {
  archiveHousehold,
  homePlan,
  householdWithFund,
  pendingIn,
  pendingOf,
  recurrenceOf,
  skipOccurrence,
  trackedRecurrences,
  transactionsIn,
  type HouseholdWithFund,
  type OccurrenceDto,
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
 * HU-E4-13 Background: CONFIRM "Electricity", estimated at 180,000 COP in Utilities, paid by Ana from Bancolombia,
 * MONTHLY(10), no split; Home (Utilities) 40 % / 60 % in the ACTIVE 2026-12 plan; the scheduler ran on 2026-12-10.
 */
const pendingElectricity = async () => {
  const h = await householdWithFund();
  const planId = await homePlan(h, "2026-12");
  const electricity = await define(h.ana, h.spaceId, {
    description: "Electricity",
    amount: cop(180_000),
    template: {
      type: "EXPENSE",
      categoryId: h.utilities,
      payer: { memberId: h.ana.memberId, accountId: h.ana.account },
    },
    schedule: { kind: "MONTHLY", day: 10 },
    mode: "CONFIRM",
    startDate: "2026-12-01",
  });
  const report = await app.ledger.materializeDueOccurrences({ today: "2026-12-10" as LocalDate });
  // The job handles every active recurrence of the database; none of this test's may have failed or paused.
  expect(
    [report.failures, report.paused].map((l) => l.filter((x) => x.recurrenceId === electricity.id)),
  ).toEqual([[], []]);
  const [pending] = await pendingOf(h.ana, h.spaceId);
  expect(pending).toBeDefined();
  return { h, planId, electricity, pending: pending! };
};
const expensesIn = async (h: HouseholdWithFund, period: string) =>
  (await transactionsIn(h.ana, h.spaceId, period)).filter((t) => t.type === "EXPENSE");

/** The problem a refused request answered with, without the member that differs on every request. */
const problemBody = async (response: Response) => {
  const body = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    body: Object.fromEntries(Object.entries(body).filter(([key]) => key !== "requestId")),
  };
};

describe("pending occurrences (HU-E4-13)", () => {
  it("creates a pending occurrence instead of an expense: Electricity of 2026-12-10 suggests 180,000 COP", async () => {
    const { h, planId, electricity, pending } = await pendingElectricity();
    expect(pending).toMatchObject({
      recurrenceId: electricity.id,
      type: "EXPENSE",
      description: "Electricity",
      date: "2026-12-10",
      status: "PENDING",
      amount: cop(180_000),
      categoryId: h.utilities,
      transactionId: null,
      reason: null,
    });
    expect(await expensesIn(h, "2026-12")).toEqual([]);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home").spent).toEqual(cop(0));
  });

  it("skips it: marked skipped, nothing recorded, and the next occurrence is 2027-01-10", async () => {
    const { h, planId, electricity, pending } = await pendingElectricity();
    const response = await skipOccurrence(h.ana, h.spaceId, pending.id);
    expect(response.status).toBe(200);
    expect((await response.json()) as OccurrenceDto).toMatchObject({
      id: pending.id,
      status: "SKIPPED",
      reason: null,
      transactionId: null,
    });
    expect([await pendingOf(h.ana, h.spaceId), await expensesIn(h, "2026-12")]).toEqual([[], []]);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home").spent).toEqual(cop(0));
    expect((await recurrenceOf(h.ana, h.spaceId, electricity.id)).nextOccurrence).toBe("2027-01-10");
  });

  it("lists them earliest date first, and a skip leaves the others pending", async () => {
    const { h, electricity } = await pendingElectricity();
    await app.ledger.materializeDueOccurrences({ today: "2027-01-10" as LocalDate });
    const listed = await pendingOf(h.ana, h.spaceId);
    expect(listed.map((o) => [o.recurrenceId, o.date, o.status])).toEqual([
      [electricity.id, "2026-12-10", "PENDING"],
      [electricity.id, "2027-01-10", "PENDING"],
    ]);
    expect((await skipOccurrence(h.ana, h.spaceId, listed[0]!.id)).status).toBe(200);
    expect((await pendingOf(h.ana, h.spaceId)).map((o) => [o.id, o.date])).toEqual([
      [listed[1]!.id, "2027-01-10"],
    ]);
  });

  it("refuses VIEWERs: Sofi gets 403 InsufficientRole on the list and on a skip", async () => {
    const { h, pending } = await pendingElectricity();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect([
      await problemOf(await pendingIn(sofi, h.spaceId)),
      await problemOf(await skipOccurrence(sofi, h.spaceId, pending.id)),
    ]).toEqual([
      [403, "InsufficientRole"],
      [403, "InsufficientRole"],
    ]);
    expect((await pendingOf(h.ana, h.spaceId)).map((o) => [o.id, o.status])).toEqual([
      [pending.id, "PENDING"],
    ]);
  });

  it("answers 404 SpaceNotFound to someone outside the space, on the list and on a skip", async () => {
    const { h, pending } = await pendingElectricity();
    const other = await householdWithFund();
    expect([
      await problemOf(await pendingIn(other.ana, h.spaceId)),
      await problemOf(await skipOccurrence(other.ana, h.spaceId, pending.id)),
    ]).toEqual([
      [404, "SpaceNotFound"],
      [404, "SpaceNotFound"],
    ]);
  });

  it("answers the same 404 OccurrenceNotFound for another space's, an unknown and a malformed occurrence", async () => {
    const { h, pending } = await pendingElectricity();
    const other = await householdWithFund();
    const answers = [
      await problemBody(await skipOccurrence(other.ana, other.spaceId, pending.id)),
      await problemBody(await skipOccurrence(h.ana, h.spaceId, randomUUID())),
      await problemBody(await skipOccurrence(h.ana, h.spaceId, "not-a-uuid")),
    ];
    expect(answers[0]).toMatchObject({ status: 404, body: { code: "OccurrenceNotFound" } });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    // Probing from another space changed nothing.
    expect((await pendingOf(h.ana, h.spaceId)).map((o) => o.status)).toEqual(["PENDING"]);
  });

  it("answers 409 OccurrenceNotPending to a second skip, and keeps the first", async () => {
    const { h, electricity, pending } = await pendingElectricity();
    expect((await skipOccurrence(h.ana, h.spaceId, pending.id)).status).toBe(200);
    expect(await problemOf(await skipOccurrence(h.ana, h.spaceId, pending.id))).toEqual([
      409,
      "OccurrenceNotPending",
    ]);
    expect((await recurrenceOf(h.ana, h.spaceId, electricity.id)).lastOccurrence).toMatchObject({
      id: pending.id,
      status: "SKIPPED",
      reason: null,
    });
  });

  it("still lists the pending occurrences of an archived space, and refuses to skip them there (HU-E1-09)", async () => {
    const { h, pending } = await pendingElectricity();
    // An archived space refuses to end its recurrences, so the fixture ends this one first; its pending occurrence stays.
    await recurrences.endAll();
    await archiveHousehold(h);
    expect((await pendingOf(h.ana, h.spaceId)).map((o) => o.id)).toEqual([pending.id]);
    expect(await problemOf(await skipOccurrence(h.ana, h.spaceId, pending.id))).toEqual([
      409,
      "SpaceArchived",
    ]);
    expect((await pendingOf(h.ana, h.spaceId)).map((o) => [o.id, o.status])).toEqual([
      [pending.id, "PENDING"],
    ]);
  });
});
