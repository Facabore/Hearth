import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import type { MaterializationReport } from "@/modules/ledger/application";
import { domainError, err, FixedClock, type LocalDate } from "@/shared/kernel";
import { startTestApp } from "../support/app";
import { cop } from "../support/ledger";
import { householdWithFund, rentBody, trackedRecurrences } from "../support/recurrences";

/**
 * The scheduler's job reads and writes through the ports `buildContainer` wires, and each of them must run on the
 * executor of the transaction manager that opened the recurrence's `tm.run` (HU-E4-12, ruling P20): a member list or a
 * space read on another pool connection would not see the state the run locked, and a repository on another
 * connection would commit what the run rolls back.
 *
 * Each case below runs the container's own `materializeDueOccurrences` inside ONE outer transaction of `app.tm`,
 * which the nested `tm.run` of every recurrence joins, after a change that is not committed. A port on another
 * connection cannot see that change, so the run decides as if it had not happened; and the outer transaction is rolled
 * back, so anything a repository wrote on another connection is still there afterwards.
 *
 * The job lists every recurrence that is due in the database, so this file keeps to a day of its own, before the
 * definition day (2026-10-28) of every other suite: only its own recurrences are due on it, and a leftover of another
 * suite can neither run inside these transactions nor break them. It ends each recurrence it defines after its test
 * (logically, D8), so that no later suite's job run finds one of them due.
 */
const DAY = "2026-01-15" as LocalDate;
const TODAY_SCHEDULE = { schedule: { kind: "MONTHLY", day: 15 }, startDate: DAY };

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: new FixedClock(new Date("2026-01-15T17:00:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** The recurrences the running test defined, ended after it. */
const recurrences = trackedRecurrences();
const { define } = recurrences;
afterEach(async () => {
  const ids = recurrences.ids();
  await recurrences.endAll();
  const stillRunning = await app.pool.query(
    "SELECT count(*)::int AS n FROM recurrences WHERE id = ANY($1) AND ended_at IS NULL",
    [ids],
  );
  expect(stillRunning.rows[0].n).toBe(0);
});

/**
 * Runs `change`, then the job, in one transaction that is rolled back; returns what the job reported. No recurrence of
 * the run failed, whichever it was: a failure inside this transaction would poison the rest of it.
 */
const jobAfter = async (change: () => Promise<void>): Promise<MaterializationReport> => {
  let report: MaterializationReport | undefined;
  const outcome = await app.tm.run(async () => {
    await change();
    report = await app.ledger.materializeDueOccurrences({ today: DAY });
    return err(domainError("RolledBack"));
  });
  expect(outcome).toEqual(err(domainError("RolledBack")));
  expect(report!.failures).toEqual([]);
  return report!;
};

/** What the job did to one recurrence of the run. */
const doneTo = (report: MaterializationReport, recurrenceId: string) => ({
  occurrences: report.occurrences
    .filter((o) => o.recurrenceId === recurrenceId)
    .map((o) => [o.status, o.reason, o.transactionId === null ? null : "a transaction"]),
  paused: report.paused.filter((p) => p.recurrenceId === recurrenceId).map((p) => p.reason),
  failures: report.failures.filter((f) => f.recurrenceId === recurrenceId),
});

const countOf = async (table: "transactions" | "recurrence_occurrences", spaceId: string): Promise<number> =>
  (await app.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE space_id = $1`, [spaceId])).rows[0].n;
const dueFromOf = async (recurrenceId: string): Promise<string> =>
  (await app.pool.query("SELECT due_from::text AS d FROM recurrences WHERE id = $1", [recurrenceId])).rows[0]
    .d;

describe("the container wires the scheduler's job onto the recurrence's transaction (HU-E4-12, P20)", () => {
  it("sees a payer who left in the same transaction: the members port reads the locked snapshot", async () => {
    const h = await householdWithFund();
    const internet = await define(h.juan, h.spaceId, {
      description: "Internet",
      amount: cop(120_000),
      template: {
        type: "EXPENSE",
        categoryId: h.utilities,
        payer: { memberId: h.juan.memberId, accountId: h.juan.account },
      },
      mode: "AUTO",
      ...TODAY_SCHEDULE,
    });
    const report = await jobAfter(async () => {
      expect((await app.spaces.leaveSpace({ spaceId: h.spaceId, userId: h.juan.userId })).ok).toBe(true);
    });
    expect(doneTo(report, internet.id)).toEqual({
      occurrences: [["SKIPPED", "PayerLeft", null]],
      paused: ["PayerLeft"],
      failures: [],
    });
  });

  it("sees a space archived in the same transaction: the access check reads the locked snapshot", async () => {
    const h = await householdWithFund();
    const rent = await define(h.ana, h.spaceId, rentBody(h, { mode: "CONFIRM", ...TODAY_SCHEDULE }));
    const report = await jobAfter(async () => {
      expect((await app.spaces.archiveSpace({ spaceId: h.spaceId, userId: h.ana.userId })).ok).toBe(true);
    });
    expect(doneTo(report, rent.id)).toEqual({
      occurrences: [["SKIPPED", "SpaceArchived", null]],
      paused: ["SpaceArchived"],
      failures: [],
    });
  });

  it("records the transaction, the occurrence and the cursor in one transaction: rolled back, nothing is left", async () => {
    const h = await householdWithFund();
    const rent = await define(h.ana, h.spaceId, rentBody(h, TODAY_SCHEDULE));
    const report = await jobAfter(async () => undefined);
    expect(doneTo(report, rent.id)).toEqual({
      occurrences: [["RECORDED", null, "a transaction"]],
      paused: [],
      failures: [],
    });
    expect([
      await countOf("transactions", h.spaceId),
      await countOf("recurrence_occurrences", h.spaceId),
      await dueFromOf(rent.id),
    ]).toEqual([0, 0, DAY]);
  });
});
