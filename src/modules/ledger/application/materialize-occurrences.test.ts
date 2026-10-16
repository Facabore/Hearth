import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { materializerWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import { recordedOccurrence, type OccurrenceId } from "../domain/occurrence";
import { statusOf } from "../domain/recurrence";
import type { Expense, Transaction } from "../domain/transaction";
import {
  createEndRecurrence,
  createPauseRecurrence,
  createResumeRecurrence,
  createUpdateRecurrence,
} from "./manage-recurrence";
import { createMaterializeDueOccurrences } from "./materialize-occurrences";
import { materializeRecurrence, type MaterializeDeps } from "./materialize-recurrence";
import { occurrenceRecorders } from "./record-occurrence";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;
const sharesOf = (tx: Transaction) =>
  (tx as Expense).shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

/** HU-E4-12 Background: AUTO "Rent", 1,200,000 COP from the Household Fund, MONTHLY(1), 2026-12-01 to 2027-01-31. */
const rentToJanuary = rentDefinition({ endDate: day("2027-01-31") });
/** HU-E4-12: Juan's AUTO "Internet", 120,000 COP from Davivienda in Household's category, MONTHLY(5), no split. */
const internet = rentDefinition({
  userId: "u-juan",
  description: "Internet",
  amount: cop(120_000n),
  template: {
    type: "EXPENSE",
    categoryId: CATEGORIES.household.id,
    payer: { memberId: "member-juan", accountId: ACCOUNTS.davivienda.id },
    split: null,
  },
  schedule: { kind: "MONTHLY", day: 5 },
});

/** The world's repositories and recorders logging what they do in `w.tm.events`, between the begin and the end of each transaction. */
const traced = (w: ReturnType<typeof materializerWorld>): MaterializeDeps => {
  const { recurrences } = w;
  const { events } = w.tm;
  const lockForWrite = recurrences.lockForWrite.bind(recurrences);
  recurrences.lockForWrite = async (spaceId, recurrenceId) => {
    events.push("lock");
    return lockForWrite(spaceId, recurrenceId);
  };
  const addOccurrence = recurrences.addOccurrence.bind(recurrences);
  recurrences.addOccurrence = async (occurrence) => {
    events.push(`occurrence ${occurrence.date}`);
    return addOccurrence(occurrence);
  };
  const save = recurrences.save.bind(recurrences);
  recurrences.save = async (recurrence) => {
    events.push(`save dueFrom ${recurrence.dueFrom}`);
    return save(recurrence);
  };
  return {
    ...w.deps,
    recorders: {
      ...w.deps.recorders,
      expense: async (input) => {
        events.push(`record ${input.date}`);
        return w.deps.recorders.expense(input);
      },
    },
  };
};

describe("MaterializeDueOccurrences (HU-E4-12)", () => {
  it("records the Rent on 2026-12-01 from the fund, on behalf of Ana, linked to its recurrence (@critical)", async () => {
    const { define, run, store, recurrences } = materializerWorld();
    const rent = await define(rentToJanuary);
    const report = await run("2026-12-01");
    const [tx] = store.rows as Expense[];
    expect([tx?.description, tx?.date, tx?.amount, tx?.createdBy, tx?.payments]).toEqual([
      "Rent",
      "2026-12-01",
      120_000_000n,
      "u-ana",
      [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount: 120_000_000n }],
    ]);
    expect(report.occurrences.map((o) => [o.recurrenceId, o.date, o.status, o.transactionId])).toEqual([
      [rent.id, "2026-12-01", "RECORDED", tx!.id],
    ]);
    expect([recurrences.rows[0]!.dueFrom, report.paused, report.failures]).toEqual(["2026-12-02", [], []]);
  });

  it("records nothing twice when it runs again on 2026-12-01", async () => {
    const { define, run, store } = materializerWorld();
    await define(rentToJanuary);
    await run("2026-12-01");
    const again = await run("2026-12-01");
    expect([store.rows.length, again.occurrences]).toEqual([1, []]);
  });

  it("catches up missed runs: the 2026-12-01 Rent on 2026-12-04, then every missed date in order", async () => {
    const { define, run, store } = materializerWorld();
    await define(rentDefinition());
    await run("2026-12-04");
    expect(store.rows.map((t) => [t.description, t.date])).toEqual([["Rent", "2026-12-01"]]);
    await run("2027-03-15");
    expect(store.rows.map((t) => t.date)).toEqual(["2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);
  });

  it("stops after its end date: nothing for 2027-02-01, and the Rent is ENDED", async () => {
    const { define, run, store, recurrences } = materializerWorld();
    await define(rentToJanuary);
    await run("2027-02-01");
    expect([store.rows.map((t) => t.date), statusOf(recurrences.rows[0]!)]).toEqual([
      ["2026-12-01", "2027-01-01"],
      "ENDED",
    ]);
  });

  it("splits Internet BY_ALLOCATION with each occurrence's period: 48,000 / 72,000 then 60,000 / 60,000 COP (golden)", async () => {
    const december = [
      { memberId: "member-ana", weight: 58_800_000n },
      { memberId: "member-juan", weight: 88_200_000n },
    ];
    const january = [
      { memberId: "member-ana", weight: 73_500_000n },
      { memberId: "member-juan", weight: 73_500_000n },
    ];
    const { define, run, store } = materializerWorld({
      weights: (date) => (date < "2027-01-01" ? december : january),
    });
    await define(internet);
    await run("2027-01-05");
    expect(store.rows.map((t) => [t.date, sharesOf(t)])).toEqual([
      [
        "2026-12-05",
        [
          ["member-ana", 4_800_000n, "BY_ALLOCATION"],
          ["member-juan", 7_200_000n, "BY_ALLOCATION"],
        ],
      ],
      [
        "2027-01-05",
        [
          ["member-ana", 6_000_000n, "BY_ALLOCATION"],
          ["member-juan", 6_000_000n, "BY_ALLOCATION"],
        ],
      ],
    ]);
  });

  it("skips the occurrence of a CLOSED period with reason PeriodClosed and records the next one (P25)", async () => {
    const { define, run, store, recurrences } = materializerWorld({
      closed: (date) => date >= "2026-12-01" && date <= "2026-12-31",
    });
    await define(rentDefinition());
    const report = await run("2027-01-01");
    expect(report.occurrences.map((o) => [o.date, o.status, o.reason])).toEqual([
      ["2026-12-01", "SKIPPED", "PeriodClosed"],
      ["2027-01-01", "RECORDED", null],
    ]);
    expect([store.rows.map((t) => t.date), statusOf(recurrences.rows[0]!), report.paused]).toEqual([
      ["2027-01-01"],
      "ACTIVE",
      [],
    ]);
  });

  it("leaves a CONFIRM occurrence PENDING with its estimate, records nothing, and skips it in a CLOSED period (HU-E4-13)", async () => {
    const { define, run, store } = materializerWorld({
      closed: (date) => date >= "2027-01-01" && date <= "2027-01-31",
    });
    await define(
      rentDefinition({
        description: "Electricity",
        amount: cop(180_000n),
        mode: "CONFIRM",
        schedule: { kind: "MONTHLY", day: 10 },
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.household.id,
          payer: { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id },
          split: null,
        },
      }),
    );
    const report = await run("2027-01-10");
    expect(report.occurrences.map((o) => [o.date, o.status, o.amount, o.reason])).toEqual([
      ["2026-12-10", "PENDING", 18_000_000n, null],
      ["2027-01-10", "SKIPPED", 18_000_000n, "PeriodClosed"],
    ]);
    expect(store.rows).toEqual([]);
  });

  it("applies an edit to future occurrences only: 1,200,000 COP on 2026-12-01, 1,300,000 COP on 2027-01-01", async () => {
    const { define, run, store, deps, clock } = materializerWorld();
    const rent = await define(rentToJanuary);
    await run("2026-12-01");
    clock.set("2026-12-15");
    unwrap(
      await createUpdateRecurrence(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        recurrenceId: rent.id,
        changes: { amount: cop(1_300_000n) },
      }),
    );
    await run("2027-01-01");
    expect(store.rows.map((t) => [t.date, t.amount])).toEqual([
      ["2026-12-01", 120_000_000n],
      ["2027-01-01", 130_000_000n],
    ]);
  });

  it("records for the user who defined the recurrence, whoever edited it: Juan raises Ana's Rent and it is still recorded as Ana (P21)", async () => {
    const { define, run, store, deps } = materializerWorld();
    const rent = await define(rentDefinition());
    unwrap(
      await createUpdateRecurrence(deps)({
        spaceId: "space-household",
        userId: "u-juan",
        recurrenceId: rent.id,
        changes: { amount: cop(1_300_000n) },
      }),
    );
    await run("2026-12-01");
    expect(store.rows.map((t) => [t.createdBy, t.amount])).toEqual([["u-ana", 130_000_000n]]);
  });

  it("skips the paused span without back-filling: Cleaning paused on 2026-12-20, resumed on 2027-02-10, records 2027-02-16", async () => {
    const { define, run, store, deps, clock } = materializerWorld();
    const cleaning = await define(
      rentDefinition({
        description: "Cleaning",
        amount: cop(80_000n),
        schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
      }),
    );
    const ref = { spaceId: "space-household", userId: "u-ana", recurrenceId: cleaning.id };
    await run("2026-12-16");
    clock.set("2026-12-20");
    unwrap(await createPauseRecurrence(deps)(ref));
    await run("2027-01-20");
    clock.set("2027-02-10");
    unwrap(await createResumeRecurrence(deps)(ref));
    await run("2027-02-20");
    expect(store.rows.map((t) => t.date)).toEqual(["2026-12-01", "2026-12-16", "2027-02-16"]);
  });

  it("drops a date that was due before a pause and that no run had considered, and a resume does not back-fill it (P24, Task 2b)", async () => {
    const { define, run, store, deps, clock } = materializerWorld();
    const rent = await define(rentDefinition());
    const ref = { spaceId: "space-household", userId: "u-ana", recurrenceId: rent.id };
    // 2026-12-01 fell due and no run happened before Ana paused the Rent on 2026-12-05.
    clock.set("2026-12-05");
    unwrap(await createPauseRecurrence(deps)(ref));
    clock.set("2026-12-10");
    unwrap(await createResumeRecurrence(deps)(ref));
    await run("2026-12-31");
    expect(store.rows).toEqual([]);
    await run("2027-01-01");
    expect(store.rows.map((t) => t.date)).toEqual(["2027-01-01"]);
  });

  it("counts a recurrence with no schedule date left as finished: nothing due, no failure, and the scheduler stops listing it (P24, Task 2b)", async () => {
    const { define, run, store, recurrences } = materializerWorld();
    // MONTHLY(1) has 2026-12-01 and 2027-01-01 before this end date, which is not a schedule date itself.
    await define(rentDefinition({ endDate: day("2027-01-15") }));
    await run("2027-01-20");
    // Its last date recorded, the cursor goes past the end date: nothing is left to consider, so no run lists it again.
    expect([
      store.rows.map((t) => t.date),
      recurrences.rows[0]!.dueFrom,
      await recurrences.listActive(day("2027-03-01")),
    ]).toEqual([["2026-12-01", "2027-01-01"], "2027-01-16", []]);
    recurrences.locked.length = 0;
    const again = await run("2027-03-01");
    expect([again, store.rows.length, recurrences.locked, statusOf(recurrences.rows[0]!)]).toEqual([
      { occurrences: [], paused: [], failures: [] },
      2,
      [],
      "ENDED",
    ]);
  });

  it("moves a recurrence past its end date when an edit left it no schedule date, and the scheduler stops listing it", async () => {
    const { define, run, deps, store, recurrences, clock } = materializerWorld();
    const rent = await define(rentDefinition());
    await run("2026-12-01");
    clock.set("2026-12-05");
    // MONTHLY(1) has no date from 2026-12-02 through 2026-12-20.
    unwrap(
      await createUpdateRecurrence(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        recurrenceId: rent.id,
        changes: { endDate: day("2026-12-20") },
      }),
    );
    expect(await recurrences.listActive(day("2026-12-31"))).toHaveLength(1);
    const report = await run("2026-12-31");
    expect([
      report,
      store.rows.length,
      recurrences.rows[0]!.dueFrom,
      await recurrences.listActive(day("2026-12-31")),
    ]).toEqual([{ occurrences: [], paused: [], failures: [] }, 1, "2026-12-21", []]);
  });

  it("takes today in the deployment's timezone, not UTC's, from the clock when no day is given", async () => {
    const { define, deps, store } = materializerWorld();
    await define(rentDefinition({ startDate: day("2026-11-01") }));
    const at = (instant: string) =>
      createMaterializeDueOccurrences({ ...deps, clock: new FixedClock(new Date(instant)) });
    // 2026-11-01T04:30Z is still 2026-10-31 in Bogotá (UTC-5): the Rent of 2026-11-01 is not due yet.
    expect([(await at("2026-11-01T04:30:00Z")({})).occurrences, store.rows]).toEqual([[], []]);
    // Half an hour later it is midnight of 2026-11-01 there.
    const report = await at("2026-11-01T05:00:00Z")({});
    expect([report.occurrences.map((o) => o.date), store.rows.length]).toEqual([["2026-11-01"], 1]);
  });

  describe("which recurrences it reads", () => {
    it("lists those due on the day it runs, and locks only the ones it handles: not a later, a paused or an ended one", async () => {
      const { define, run, deps, recurrences } = materializerWorld();
      const rent = await define(rentDefinition());
      await define(rentDefinition({ description: "Gym", startDate: day("2027-03-01") }));
      const insurance = await define(rentDefinition({ description: "Insurance" }));
      const loan = await define(rentDefinition({ description: "Old loan" }));
      const ref = (recurrenceId: string) => ({ spaceId: "space-household", userId: "u-ana", recurrenceId });
      unwrap(await createPauseRecurrence(deps)(ref(insurance.id)));
      unwrap(await createEndRecurrence(deps)(ref(loan.id)));
      recurrences.locked.length = 0;
      const asked: string[] = [];
      const listActive = recurrences.listActive.bind(recurrences);
      recurrences.listActive = async (today) => {
        asked.push(today);
        return listActive(today);
      };
      const report = await run("2026-12-01");
      expect([asked, recurrences.locked, report.occurrences.map((o) => o.recurrenceId)]).toEqual([
        ["2026-12-01"],
        [rent.id],
        [rent.id],
      ]);
    });

    it("opens no transaction while nothing is due", async () => {
      const { define, run, tm, store } = materializerWorld();
      await define(rentDefinition());
      tm.events.length = 0;
      expect([await run("2026-11-30"), tm.events, store.rows]).toEqual([
        { occurrences: [], paused: [], failures: [] },
        [],
        [],
      ]);
    });
  });

  describe("the obligations of recordOccurrence (Task 8a)", () => {
    it("records and writes the occurrence rows in the one transaction that holds the recurrence's lock, and commits it with a refused date SKIPPED", async () => {
      const w = materializerWorld({ closed: (date) => date < "2027-01-01" });
      await w.define(rentDefinition());
      w.tm.events.length = 0;
      const deps = traced(w);
      await createMaterializeDueOccurrences(deps)({ today: day("2027-01-01") });
      expect(w.tm.events).toEqual([
        "begin",
        "lock",
        "record 2026-12-01",
        "occurrence 2026-12-01",
        "record 2027-01-01",
        "occurrence 2027-01-01",
        "save dueFrom 2027-01-02",
        "commit",
      ]);
      expect(w.recurrences.occurrenceRows.map((o) => [o.date, o.status, o.reason])).toEqual([
        ["2026-12-01", "SKIPPED", "PeriodClosed"],
        ["2027-01-01", "RECORDED", null],
      ]);
      // The refusal left no transaction behind: the SKIPPED date has none.
      expect(w.store.rows.map((t) => t.date)).toEqual(["2027-01-01"]);
    });

    it("stores the code that refused a date, whatever it is", async () => {
      const w = materializerWorld();
      await w.define(rentDefinition());
      const retired = occurrenceRecorders({
        ...w.deps,
        categories: { find: async (_spaceId, id) => ({ id, archived: true }) },
      });
      const report = await createMaterializeDueOccurrences({ ...w.deps, recorders: retired })({
        today: day("2026-12-01"),
      });
      expect([report.occurrences.map((o) => [o.status, o.reason, o.transactionId]), w.store.rows]).toEqual([
        [["SKIPPED", "CategoryArchived", null]],
        [],
      ]);
    });

    it("fails the run of a recurrence whose stored amount cannot be recorded, instead of skipping its dates for good", async () => {
      const w = materializerWorld();
      const rent = await w.define(rentDefinition());
      w.recurrences.rows = w.recurrences.rows.map((r) => ({ ...r, currency: "???" }));
      const report = await w.run("2026-12-01");
      expect([
        report.failures,
        report.occurrences,
        w.recurrences.occurrenceRows,
        w.recurrences.rows[0]!.dueFrom,
      ]).toEqual([
        [{ recurrenceId: rent.id, spaceId: "space-household", error: "InvalidStoredAmount" }],
        [],
        [],
        "2026-12-01",
      ]);
    });

    it("reports a database failure by its SQLSTATE and constraint, never by its message, query or parameters", async () => {
      const w = materializerWorld();
      const rent = await w.define(rentDefinition());
      const deps: MaterializeDeps = {
        ...w.deps,
        recorders: {
          ...w.deps.recorders,
          expense: async () => {
            throw new Error("Failed query: insert into transactions params: ana@example.com", {
              cause: {
                code: "23505",
                constraint: "transactions_pkey",
                detail: "Key (contact_email)=(ana@example.com) already exists.",
              },
            });
          },
        },
      };
      const report = await createMaterializeDueOccurrences(deps)({ today: day("2026-12-01") });
      expect(report.failures).toEqual([
        {
          recurrenceId: rent.id,
          spaceId: "space-household",
          error: "Error",
          code: "23505",
          constraint: "transactions_pkey",
        },
      ]);
      expect(JSON.stringify(report.failures)).not.toContain("ana@example.com");
    });

    it("reports a run that throws, rolls that run back whole, and goes on with the others", async () => {
      const w = materializerWorld();
      const rent = await w.define(rentDefinition());
      const broken = await w.define(rentDefinition({ description: "Broken" }));
      const deps: MaterializeDeps = {
        ...w.deps,
        recorders: {
          ...w.deps.recorders,
          expense: async (input) => {
            if (input.description === "Broken" && input.date === day("2027-01-01"))
              throw new Error("boom for ana@example.com");
            return w.deps.recorders.expense(input);
          },
        },
      };
      const report = await createMaterializeDueOccurrences(deps)({ today: day("2027-01-01") });
      expect([report.failures, report.occurrences.map((o) => o.recurrenceId)]).toEqual([
        [{ recurrenceId: broken.id, spaceId: "space-household", error: "Error" }],
        [rent.id, rent.id],
      ]);
      expect(JSON.stringify(report.failures)).not.toContain("ana@example.com");
      // Broken recorded 2026-12-01 before 2027-01-01 threw: none of it stayed, and its cursor did not move.
      expect([
        w.store.rows.map((t) => [t.description, t.date]),
        w.recurrences.occurrenceRows.map((o) => o.recurrenceId),
        w.recurrences.rows.map((r) => [r.id, r.dueFrom]),
      ]).toEqual([
        [
          ["Rent", "2026-12-01"],
          ["Rent", "2027-01-01"],
        ],
        [rent.id, rent.id],
        [
          [rent.id, "2027-01-02"],
          [broken.id, "2026-12-01"],
        ],
      ]);
      // The next run retries it, and only it.
      const retry = await w.run("2027-01-01");
      expect(retry.occurrences.map((o) => [o.recurrenceId, o.date])).toEqual([
        [broken.id, "2026-12-01"],
        [broken.id, "2027-01-01"],
      ]);
    });
  });

  describe("two runs, or a run and a member, one after the other (Review Focus 1)", () => {
    it("a run that waited for another reads the dueFrom it committed and records nothing", async () => {
      const { define, deps, recurrences, store } = materializerWorld();
      await define(rentToJanuary);
      // Both runs listed the Rent before either took its lock.
      const [listed] = await recurrences.listActive(day("2026-12-01"));
      const first = unwrap(await materializeRecurrence(deps, listed!, day("2026-12-01")));
      const waited = unwrap(await materializeRecurrence(deps, listed!, day("2026-12-01")));
      expect([first.occurrences.length, waited.occurrences, store.rows.length]).toEqual([1, [], 1]);
    });

    it("a run that waited for a pause reads it and records nothing", async () => {
      const { define, deps, recurrences, store } = materializerWorld();
      const rent = await define(rentToJanuary);
      const [listed] = await recurrences.listActive(day("2026-12-01"));
      unwrap(
        await createPauseRecurrence(deps)({
          spaceId: "space-household",
          userId: "u-ana",
          recurrenceId: rent.id,
        }),
      );
      const waited = unwrap(await materializeRecurrence(deps, listed!, day("2026-12-01")));
      expect([waited.occurrences, store.rows, recurrences.occurrenceRows]).toEqual([[], [], []]);
    });

    it("a run that waited for a new schedule reads it, finds no date due and writes nothing", async () => {
      const { define, deps, recurrences, store } = materializerWorld();
      const rent = await define(rentToJanuary);
      const [listed] = await recurrences.listActive(day("2026-12-01"));
      unwrap(
        await createUpdateRecurrence(deps)({
          spaceId: "space-household",
          userId: "u-ana",
          recurrenceId: rent.id,
          changes: { schedule: { kind: "MONTHLY", day: 20 } },
        }),
      );
      const waited = unwrap(await materializeRecurrence(deps, listed!, day("2026-12-01")));
      expect([waited.occurrences, store.rows, recurrences.rows[0]!.dueFrom]).toEqual([[], [], "2026-12-01"]);
    });

    it("the unique key refuses a second occurrence of a date, and its rollback leaves no transaction behind", async () => {
      const w = materializerWorld();
      const rent = await w.define(rentDefinition());
      // An occurrence of 2026-12-01 that the cursor never passed, so the run decides that date again.
      await w.recurrences.addOccurrence(
        recordedOccurrence(
          "occ-earlier" as OccurrenceId,
          rent,
          day("2026-12-01"),
          "tx-earlier",
          w.clock.now(),
        ),
      );
      const report = await w.run("2026-12-01");
      expect([
        report.failures,
        report.occurrences,
        w.store.rows,
        w.recurrences.occurrenceRows.map((o) => o.id),
        w.recurrences.rows[0]!.dueFrom,
      ]).toEqual([
        [
          {
            recurrenceId: rent.id,
            spaceId: "space-household",
            error: "Error",
            code: "23505",
            constraint: "recurrence_occurrences_date_uq",
          },
        ],
        [],
        [],
        ["occ-earlier"],
        "2026-12-01",
      ]);
    });
  });

  describe("catching up (CATCH_UP_LIMIT)", () => {
    it("considers 24 dates per recurrence and run: a 30-date backlog takes two runs, and dueFrom moves past the last date handled", async () => {
      const { define, run, store, recurrences } = materializerWorld();
      await define(rentDefinition());
      // MONTHLY(1) from 2026-12-01: the 30th date is 2029-05-01.
      const first = await run("2029-05-01");
      expect([
        first.occurrences.length,
        first.occurrences.at(-1)?.date,
        recurrences.rows[0]!.dueFrom,
      ]).toEqual([24, "2028-11-01", "2028-11-02"]);
      const second = await run("2029-05-01");
      expect([second.occurrences.map((o) => o.date), recurrences.rows[0]!.dueFrom]).toEqual([
        ["2028-12-01", "2029-01-01", "2029-02-01", "2029-03-01", "2029-04-01", "2029-05-01"],
        "2029-05-02",
      ]);
      expect([(await run("2029-05-01")).occurrences, store.rows.length]).toEqual([[], 30]);
    });
  });
});
