import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import type { LocalDate } from "@/shared/kernel";
import { problemOf, startTestApp } from "../support/app";
import { closePlan, lineNamed, planOf } from "../support/budgeting";
import { MovableClock } from "../support/in-memory-recurrences";
import { cop, joinHousehold, type TransactionDto } from "../support/ledger";
import {
  archiveHousehold,
  confirmOccurrence,
  homePlan,
  householdWithFund,
  pendingIn,
  pendingOf,
  recurrenceOf,
  rentBody,
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

describe("confirming a pending occurrence (HU-E4-13)", () => {
  const sharesOf = (tx: TransactionDto) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);
  const pendingStatuses = async (h: HouseholdWithFund) =>
    (await pendingOf(h.ana, h.spaceId)).map((o) => o.status);

  /** A CONFIRM recurrence of `h` due on 2026-12-01, run by the job; returns the one pending occurrence. */
  const pendingFrom = async (h: HouseholdWithFund, body: Record<string, unknown>) => {
    const recurrence = await define(h.ana, h.spaceId, { ...body, mode: "CONFIRM", startDate: "2026-12-01" });
    await app.ledger.materializeDueOccurrences({ today: "2026-12-01" as LocalDate });
    const [pending] = await pendingOf(h.ana, h.spaceId);
    expect(pending).toMatchObject({ recurrenceId: recurrence.id, status: "PENDING" });
    return pending!;
  };

  it("records the actual 205,300 COP split 82,120 / 123,180 COP by Home's allocation (@critical)", async () => {
    const { h, planId, electricity, pending } = await pendingElectricity();
    const response = await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) });
    expect(response.status).toBe(201);
    const { warnings, ...tx } = (await response.json()) as TransactionDto & { warnings: unknown[] };
    expect([tx.description, tx.date, tx.amount, sharesOf(tx), warnings]).toEqual([
      "Electricity",
      "2026-12-10",
      cop(205_300),
      [
        [h.ana.memberId, cop(82_120), "BY_ALLOCATION"],
        [h.juan.memberId, cop(123_180), "BY_ALLOCATION"],
      ],
      [],
    ]);
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`);
    expect(response.headers.get("etag")).toBe(`"${tx.version}"`);
    // Read back over HTTP: one expense, the very one answered, and Home spent what was really paid.
    expect([await pendingStatuses(h), await expensesIn(h, "2026-12")]).toEqual([[], [tx]]);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home").spent).toEqual(cop(205_300));
    // The recurrence keeps its estimate for the next month; the occurrence keeps what was paid.
    const recurrence = await recurrenceOf(h.ana, h.spaceId, electricity.id);
    expect([recurrence.amount, recurrence.nextOccurrence, recurrence.lastOccurrence]).toEqual([
      cop(180_000),
      "2027-01-10",
      expect.objectContaining({
        id: pending.id,
        status: "RECORDED",
        amount: cop(205_300),
        transactionId: tx.id,
      }),
    ]);
  });

  it("answers the warnings of a fund-paid expense that leaves the fund negative: Rent of 1,300,000 COP (HU-E4-10)", async () => {
    const h = await householdWithFund();
    const pending = await pendingFrom(h, rentBody(h));
    const response = await confirmOccurrence(h.juan, h.spaceId, pending.id, { amount: cop(1_300_000) });
    expect(response.status).toBe(201);
    const tx = (await response.json()) as TransactionDto & { warnings: unknown[] };
    expect([tx.amount, tx.payments.map((p) => [p.memberId, p.accountId, p.amount]), tx.warnings]).toEqual([
      cop(1_300_000),
      [[null, h.fund, cop(1_300_000)]],
      [{ code: "FundBalanceNegative", accountId: h.fund, balance: cop(-1_300_000) }],
    ]);
  });

  it("answers the transaction of any type, a fund contribution too (a transfer to the fund): no shares, no warnings", async () => {
    const h = await householdWithFund();
    const pending = await pendingFrom(h, {
      description: "Savings",
      amount: cop(500_000),
      template: { type: "FUND_CONTRIBUTION", fundAccountId: h.fund, sourceAccountId: h.ana.account },
      schedule: { kind: "MONTHLY", day: 1 },
    });
    const response = await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(600_000) });
    expect(response.status).toBe(201);
    const tx = (await response.json()) as TransactionDto & { warnings: unknown[] };
    expect([tx.type, tx.amount, tx.destinationAccountId, tx.shares, tx.warnings]).toEqual([
      "TRANSFER",
      cop(600_000),
      h.fund,
      [],
      [],
    ]);
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`);
  });

  it("refuses to confirm into the 2026-12 plan once it was CLOSED while the occurrence waited: 409 PeriodClosed", async () => {
    const { h, planId, pending } = await pendingElectricity();
    // The plan closes only once its period has ended (P17 amended); the occurrence is still pending then.
    clock.set("2027-01-02");
    expect((await closePlan(h.ana, h.spaceId, planId)).status).toBe(200);
    expect(
      await problemOf(await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) })),
    ).toEqual([409, "PeriodClosed"]);
    expect([await pendingStatuses(h), await expensesIn(h, "2026-12")]).toEqual([["PENDING"], []]);
  });

  it("refuses Sofi the VIEWER (403) and Juan, for a debit from Ana's account (422 AccountNotOwned, D9)", async () => {
    const { h, pending } = await pendingElectricity();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect([
      await problemOf(await confirmOccurrence(sofi, h.spaceId, pending.id, { amount: cop(205_300) })),
      await problemOf(await confirmOccurrence(h.juan, h.spaceId, pending.id, { amount: cop(205_300) })),
    ]).toEqual([
      [403, "InsufficientRole"],
      [422, "AccountNotOwned"],
    ]);
    // Both refusals left it pending, so Ana, the owner of the account, still confirms it.
    expect([await pendingStatuses(h), await expensesIn(h, "2026-12")]).toEqual([["PENDING"], []]);
    expect((await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) })).status).toBe(
      201,
    );
  });

  it("moves the date only within the occurrence's period: 2027-01-01 and 2026-11-30 are 422 InvalidOccurrenceDate", async () => {
    const { h, pending } = await pendingElectricity();
    const refused = [];
    for (const date of ["2027-01-01", "2026-11-30"])
      refused.push(
        await problemOf(
          await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300), date }),
        ),
      );
    expect(refused).toEqual([
      [422, "InvalidOccurrenceDate"],
      [422, "InvalidOccurrenceDate"],
    ]);
    expect([await pendingStatuses(h), await expensesIn(h, "2026-12")]).toEqual([["PENDING"], []]);
    // The last day of the period is still the period.
    const response = await confirmOccurrence(h.ana, h.spaceId, pending.id, {
      amount: cop(205_300),
      date: "2026-12-31",
    });
    expect([response.status, ((await response.json()) as TransactionDto).date]).toEqual([201, "2026-12-31"]);
  });

  it("accepts the first day of the occurrence's period: 2026-12-01 is recorded", async () => {
    const { h, pending } = await pendingElectricity();
    const response = await confirmOccurrence(h.ana, h.spaceId, pending.id, {
      amount: cop(205_300),
      date: "2026-12-01",
    });
    expect([response.status, ((await response.json()) as TransactionDto).date]).toEqual([201, "2026-12-01"]);
    expect((await expensesIn(h, "2026-12")).map((t) => t.date)).toEqual(["2026-12-01"]);
  });

  it("refuses an amount that is not positive, a currency other than the space's and a date the API cannot read: 422, still pending", async () => {
    const { h, pending } = await pendingElectricity();
    const bodies = [
      {},
      { amount: cop(0) },
      { amount: { amount: "20530000", currency: "USD" } },
      // An impossible date fails the schema; a real one before 1900 passes it and fails the kernel.
      { amount: cop(205_300), date: "2026-02-30" },
      { amount: cop(205_300), date: "1899-12-31" },
    ];
    const answers = [];
    for (const body of bodies)
      answers.push(await problemOf(await confirmOccurrence(h.ana, h.spaceId, pending.id, body)));
    expect(answers).toEqual([
      [422, "ValidationFailed"],
      [422, "InvalidAmount"],
      [422, "CurrencyMismatch"],
      [422, "ValidationFailed"],
      [422, "InvalidDate"],
    ]);
    expect(await pendingStatuses(h)).toEqual(["PENDING"]);
  });

  it("replays an Idempotency-Key with the first answer, and refuses the key with another body (spec 7)", async () => {
    const { h, pending } = await pendingElectricity();
    const key = { "idempotency-key": "electricity-2026-12" };
    const first = await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) }, key);
    const replay = await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) }, key);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(await replay.json()).toEqual(await first.json());
    expect([replay.headers.get("etag"), replay.headers.get("location")]).toEqual([
      first.headers.get("etag"),
      first.headers.get("location"),
    ]);
    expect(
      await problemOf(await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(1_000) }, key)),
    ).toEqual([409, "IdempotencyKeyConflict"]);
    expect(await expensesIn(h, "2026-12")).toHaveLength(1);
  });

  it("answers 409 OccurrenceNotPending to a second confirm and to a skip after it, keeping one expense", async () => {
    const { h, pending } = await pendingElectricity();
    expect((await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) })).status).toBe(
      201,
    );
    expect([
      await problemOf(await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(100_000) })),
      await problemOf(await skipOccurrence(h.ana, h.spaceId, pending.id)),
    ]).toEqual([
      [409, "OccurrenceNotPending"],
      [409, "OccurrenceNotPending"],
    ]);
    expect((await expensesIn(h, "2026-12")).map((t) => t.amount)).toEqual([cop(205_300)]);
  });

  it("answers 409 OccurrenceNotPending to a confirm after a skip, recording nothing", async () => {
    const { h, pending } = await pendingElectricity();
    expect((await skipOccurrence(h.ana, h.spaceId, pending.id)).status).toBe(200);
    expect(
      await problemOf(await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) })),
    ).toEqual([409, "OccurrenceNotPending"]);
    expect(await expensesIn(h, "2026-12")).toEqual([]);
  });

  it("answers 404 SpaceNotFound to someone outside the space", async () => {
    const { h, pending } = await pendingElectricity();
    const other = await householdWithFund();
    expect(
      await problemOf(await confirmOccurrence(other.ana, h.spaceId, pending.id, { amount: cop(205_300) })),
    ).toEqual([404, "SpaceNotFound"]);
    expect(await pendingStatuses(h)).toEqual(["PENDING"]);
  });

  it("answers the same 404 OccurrenceNotFound for another space's, an unknown and a malformed occurrence", async () => {
    const { h, pending } = await pendingElectricity();
    const other = await householdWithFund();
    const body = { amount: cop(205_300) };
    const answers = [
      await problemBody(await confirmOccurrence(other.ana, other.spaceId, pending.id, body)),
      await problemBody(await confirmOccurrence(h.ana, h.spaceId, randomUUID(), body)),
      await problemBody(await confirmOccurrence(h.ana, h.spaceId, "not-a-uuid", body)),
    ];
    expect(answers[0]).toMatchObject({ status: 404, body: { code: "OccurrenceNotFound" } });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    // Probing from another space recorded nothing.
    expect([await pendingStatuses(h), await expensesIn(h, "2026-12")]).toEqual([["PENDING"], []]);
  });

  it("refuses to confirm in an archived space (409 SpaceArchived), where the occurrence stays pending (HU-E1-09)", async () => {
    const { h, pending } = await pendingElectricity();
    // An archived space refuses to end its recurrences, so the fixture ends this one first; its pending occurrence stays.
    await recurrences.endAll();
    await archiveHousehold(h);
    expect(
      await problemOf(await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) })),
    ).toEqual([409, "SpaceArchived"]);
    expect([await pendingStatuses(h), await expensesIn(h, "2026-12")]).toEqual([["PENDING"], []]);
  });
});
