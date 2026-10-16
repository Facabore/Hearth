import { describe, expect, it } from "vitest";
import type { SpaceId } from "@/modules/spaces/application";
import { domainError, err, type LocalDate, type StoredPeriod } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import {
  materializerWorld,
  rentDefinition,
  type BudgetingStandIn,
} from "../../../../tests/support/in-memory-recurrences";
import { statusOf } from "../domain/recurrence";
import type { Expense } from "../domain/transaction";
import { createEndRecurrence, createPauseRecurrence } from "./manage-recurrence";
import type { MaterializeDeps } from "./materialize-recurrence";
import {
  createConfirmOccurrence,
  createListPendingOccurrences,
  createSkipOccurrence,
} from "./pending-occurrences";
import type { OccurrenceRepository } from "./recurrence-ports";
import { createGetRecurrence } from "./recurrence-queries";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;
/** Home in the ACTIVE 2026-12 plan: Ana 588,000 and Juan 882,000 COP assigned (40 % / 60 %). */
const home = () => [
  { memberId: "member-ana", weight: 58_800_000n },
  { memberId: "member-juan", weight: 88_200_000n },
];
/** Home in the ACTIVE 2027-01 plan: Ana and Juan 735,000 COP each (50 % / 50 %). */
const homeInJanuary = () => [
  { memberId: "member-ana", weight: 73_500_000n },
  { memberId: "member-juan", weight: 73_500_000n },
];
const sharesOf = (tx: Expense) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

const paidByAnaFromBancolombia = {
  type: "EXPENSE",
  categoryId: CATEGORIES.household.id,
  payer: { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id },
  split: null,
} as const;
const paidFromTheFund = {
  type: "EXPENSE",
  categoryId: CATEGORIES.household.id,
  payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
  split: null,
} as const;
const paidByPedro = {
  type: "EXPENSE",
  categoryId: CATEGORIES.household.id,
  payer: { memberId: "member-pedro", accountId: null },
  split: null,
} as const;

/**
 * HU-E4-13 Background: CONFIRM "Electricity", estimated at 180,000 COP, paid by Ana from Bancolombia, MONTHLY(10),
 * no split (BY_ALLOCATION by Home).
 */
const electricity = (overrides: Parameters<typeof rentDefinition>[0] = {}) =>
  rentDefinition({
    description: "Electricity",
    amount: cop(180_000n),
    mode: "CONFIRM",
    schedule: { kind: "MONTHLY", day: 10 },
    template: paidByAnaFromBancolombia,
    ...overrides,
  });

/** The scheduler ran through `today` (2026-12-10: the Electricity of that day is PENDING) with `home` as the allocation. */
const pendingOccurrences = async (
  budgeting: BudgetingStandIn = {},
  definition = electricity(),
  today = "2026-12-10",
) => {
  const w = materializerWorld({ weights: home, ...budgeting });
  const recurrence = await w.define(definition);
  await w.run(today);
  const occurrence = w.recurrences.occurrenceRows[0]!;
  const ref = (userId = "u-ana", of = occurrence) => ({
    spaceId: "space-household",
    userId,
    occurrenceId: of.id,
  });
  return {
    ...w,
    recurrence,
    occurrence,
    ref,
    list: createListPendingOccurrences(w.deps),
    confirm: createConfirmOccurrence(w.deps),
    skip: createSkipOccurrence(w.deps),
  };
};
const pendingElectricity = (budgeting: BudgetingStandIn = {}) => pendingOccurrences(budgeting);

/**
 * The world's occurrence store and expense recorder logging what a confirmation or a skip does in `w.tm.events`,
 * between the begin and the end of its transaction.
 */
const traced = (w: Awaited<ReturnType<typeof pendingOccurrences>>): MaterializeDeps => {
  const { events } = w.tm;
  events.length = 0;
  // Through the port, whose `findOccurrence` takes the `lock` option the in-memory class does not declare.
  const occurrences: OccurrenceRepository = w.recurrences;
  const findOccurrence = occurrences.findOccurrence.bind(occurrences);
  occurrences.findOccurrence = async (spaceId, occurrenceId, options) => {
    events.push(options?.lock === true ? "lock occurrence" : "read occurrence");
    return findOccurrence(spaceId, occurrenceId, options);
  };
  const saveOccurrence = occurrences.saveOccurrence.bind(occurrences);
  occurrences.saveOccurrence = async (occurrence) => {
    events.push(`save ${occurrence.date} ${occurrence.status}`);
    return saveOccurrence(occurrence);
  };
  return {
    ...w.deps,
    recorders: {
      ...w.deps.recorders,
      expense: async (input) => {
        events.push(`record ${input.date} as ${input.userId}`);
        return w.deps.recorders.expense(input);
      },
    },
  };
};

describe("pending occurrences (HU-E4-13)", () => {
  it("lists the pending Electricity of 2026-12-10 suggesting 180,000 COP, with no expense recorded", async () => {
    const { list, store, recurrence } = await pendingElectricity();
    const pending = unwrap(await list({ spaceId: "space-household", userId: "u-luis" }));
    expect(
      pending.map((p) => [p.occurrence.date, p.occurrence.status, p.occurrence.amount, p.recurrence.id]),
    ).toEqual([["2026-12-10", "PENDING", 18_000_000n, recurrence.id]]);
    expect(store.rows).toEqual([]);
  });

  it("lists them for MEMBER or above, and only for the space they are asked in", async () => {
    const { list } = await pendingElectricity();
    const counts: number[] = [];
    for (const userId of ["u-ana", "u-juan", "u-luis"]) {
      counts.push(unwrap(await list({ spaceId: "space-household", userId })).length);
    }
    expect(counts).toEqual([1, 1, 1]);
    expect(unwrap(await list({ spaceId: "space-ana", userId: "u-ana" }))).toEqual([]);
    expect(codeOf(await list({ spaceId: "space-household", userId: "u-nobody" }))).toBe("SpaceNotFound");
  });

  it("records the confirmed 205,300 COP split 82,120 / 123,180 COP by Home's allocation (@critical)", async () => {
    const { confirm, ref, store, recurrences } = await pendingElectricity();
    const confirmed = unwrap(await confirm({ ...ref(), amount: cop(205_300n) }));
    const tx = store.rows[0] as Expense;
    expect([tx.description, tx.date, tx.amount, tx.createdBy, sharesOf(tx)]).toEqual([
      "Electricity",
      "2026-12-10",
      20_530_000n,
      "u-ana",
      [
        ["member-ana", 8_212_000n, "BY_ALLOCATION"],
        ["member-juan", 12_318_000n, "BY_ALLOCATION"],
      ],
    ]);
    expect([confirmed.transaction.id, confirmed.occurrence.status, confirmed.occurrence.amount]).toEqual([
      tx.id,
      "RECORDED",
      20_530_000n,
    ]);
    expect(store.rows).toHaveLength(1);
    expect(recurrences.occurrenceRows[0]).toMatchObject({
      status: "RECORDED",
      transactionId: tx.id,
      resolvedBy: "u-ana",
    });
  });

  it("splits each occurrence by the plan of its own period, whenever it is confirmed: 82,120 / 123,180 COP in 2026-12 and 102,650 COP each in 2027-01 (Review Focus 4)", async () => {
    const w = await pendingOccurrences(
      { weights: (date) => (date < "2027-01-01" ? home() : homeInJanuary()) },
      electricity(),
      "2027-01-10",
    );
    const [december, january] = w.recurrences.occurrenceRows;
    // Both are confirmed in January, the later one first: the period is the occurrence's, never the day of confirming.
    w.clock.set("2027-01-12");
    unwrap(await w.confirm({ ...w.ref("u-ana", january!), amount: cop(205_300n) }));
    unwrap(await w.confirm({ ...w.ref("u-ana", december!), amount: cop(205_300n) }));
    expect(w.store.rows.map((t) => [t.date, sharesOf(t as Expense)])).toEqual([
      [
        "2027-01-10",
        [
          ["member-ana", 10_265_000n, "BY_ALLOCATION"],
          ["member-juan", 10_265_000n, "BY_ALLOCATION"],
        ],
      ],
      [
        "2026-12-10",
        [
          ["member-ana", 8_212_000n, "BY_ALLOCATION"],
          ["member-juan", 12_318_000n, "BY_ALLOCATION"],
        ],
      ],
    ]);
  });

  it("skips it: nothing is recorded, and the next occurrence is 2027-01-10", async () => {
    const { skip, ref, store, deps, recurrence } = await pendingElectricity();
    const skipped = unwrap(await skip(ref()));
    expect([
      skipped.occurrence.status,
      skipped.occurrence.reason,
      skipped.occurrence.resolvedBy,
      store.rows,
    ]).toEqual(["SKIPPED", null, "u-ana", []]);
    const read = unwrap(
      await createGetRecurrence(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        recurrenceId: recurrence.id,
      }),
    );
    expect([read.nextOccurrence, read.lastOccurrence?.status]).toEqual(["2027-01-10", "SKIPPED"]);
  });

  it("refuses VIEWERs: Sofi can neither confirm, skip nor list", async () => {
    const { confirm, skip, list, ref, store, recurrences } = await pendingElectricity();
    expect([
      codeOf(await confirm({ ...ref("u-sofi"), amount: cop(205_300n) })),
      codeOf(await skip(ref("u-sofi"))),
      codeOf(await list({ spaceId: "space-household", userId: "u-sofi" })),
    ]).toEqual(["InsufficientRole", "InsufficientRole", "InsufficientRole"]);
    expect([store.rows, recurrences.occurrenceRows[0]!.status]).toEqual([[], "PENDING"]);
  });

  it("refuses to confirm into a period that was CLOSED while the occurrence waited: PeriodClosed (P25)", async () => {
    let closed = false;
    const { confirm, ref, store, recurrences } = await pendingElectricity({ closed: () => closed });
    closed = true;
    expect(codeOf(await confirm({ ...ref(), amount: cop(205_300n) }))).toBe("PeriodClosed");
    expect([store.rows, recurrences.occurrenceRows[0]!.status]).toEqual([[], "PENDING"]);
  });

  describe("the date of a confirmation (Review Focus 2)", () => {
    it("moves only within the occurrence's period: the day before it and the next period are InvalidOccurrenceDate", async () => {
      const { confirm, ref, store, recurrences } = await pendingElectricity();
      const amount = cop(205_300n);
      // 2026-12 runs from 2026-12-01 through 2026-12-31 (Household is MONTHLY(1)). One after the other: the
      // in-memory transaction manager is not safe for concurrent runs.
      const refused: string[] = [];
      for (const date of ["2026-11-30", "2027-01-01", "2027-01-02"]) {
        refused.push(codeOf(await confirm({ ...ref(), amount, date: day(date) })));
      }
      expect(refused).toEqual(["InvalidOccurrenceDate", "InvalidOccurrenceDate", "InvalidOccurrenceDate"]);
      expect([store.rows, recurrences.occurrenceRows[0]!.status]).toEqual([[], "PENDING"]);
    });

    it("takes the period from the space's policy: in a SEMI_MONTHLY(1, 16) space the 2026-12-10 occurrence moves within 2026-12 H1 and not into H2", async () => {
      const { confirm, ref, store, recurrences, spaces } = await pendingElectricity();
      await spaces.updateSettings("space-household" as SpaceId, {
        name: "Household",
        currency: "COP",
        periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
      });
      const amount = cop(205_300n);
      // H1 runs from 2026-12-01 through 2026-12-15; MONTHLY(1) would take the second half of the month too.
      const refused: string[] = [];
      for (const date of ["2026-11-30", "2026-12-16", "2026-12-31"]) {
        refused.push(codeOf(await confirm({ ...ref(), amount, date: day(date) })));
      }
      expect([refused, store.rows, recurrences.occurrenceRows[0]!.status]).toEqual([
        ["InvalidOccurrenceDate", "InvalidOccurrenceDate", "InvalidOccurrenceDate"],
        [],
        "PENDING",
      ]);
      unwrap(await confirm({ ...ref(), amount, date: day("2026-12-15") }));
      expect([store.rows[0]!.date, recurrences.occurrenceRows[0]!.date]).toEqual([
        "2026-12-15",
        "2026-12-10",
      ]);
    });

    it.each(["2026-12-01", "2026-12-28", "2026-12-31"])(
      "records on %s, any day of its period, and the occurrence keeps its scheduled date as its identity",
      async (date) => {
        const { confirm, ref, store, recurrences } = await pendingElectricity();
        unwrap(await confirm({ ...ref(), amount: cop(205_300n), date: day(date) }));
        expect([store.rows[0]!.date, recurrences.occurrenceRows[0]!.date]).toEqual([date, "2026-12-10"]);
      },
    );

    it("resolves the period with the stored plan periods (D10): a plan running through 2027-01-04 takes 2027-01-02 and refuses 2026-12-04", async () => {
      const w = await pendingElectricity();
      const stored: StoredPeriod[] = [{ start: day("2026-12-05"), end: day("2027-01-04"), label: "2026-12" }];
      const confirm = createConfirmOccurrence({ ...w.deps, storedPeriods: async () => stored });
      const amount = cop(205_300n);
      // The policy's own period would take 2026-12-04 and refuse 2027-01-02.
      expect([
        codeOf(await confirm({ ...w.ref(), amount, date: day("2026-12-04") })),
        codeOf(await confirm({ ...w.ref(), amount, date: day("2027-01-05") })),
        w.store.rows,
      ]).toEqual(["InvalidOccurrenceDate", "InvalidOccurrenceDate", []]);
      unwrap(await confirm({ ...w.ref(), amount, date: day("2027-01-02") }));
      expect(w.store.rows.map((t) => t.date)).toEqual(["2027-01-02"]);
    });
  });

  it("confirms once: a second confirm or a skip answers OccurrenceNotPending", async () => {
    const { confirm, skip, ref, store } = await pendingElectricity();
    unwrap(await confirm({ ...ref(), amount: cop(205_300n) }));
    expect([
      codeOf(await confirm({ ...ref(), amount: cop(1n) })),
      codeOf(await skip(ref())),
      store.rows.length,
    ]).toEqual(["OccurrenceNotPending", "OccurrenceNotPending", 1]);
  });

  it("skips once: a second skip or a confirm answers OccurrenceNotPending, and nothing is recorded", async () => {
    const { confirm, skip, ref, store } = await pendingElectricity();
    unwrap(await skip(ref()));
    expect([
      codeOf(await skip(ref())),
      codeOf(await confirm({ ...ref(), amount: cop(205_300n) })),
      store.rows,
    ]).toEqual(["OccurrenceNotPending", "OccurrenceNotPending", []]);
  });

  describe("D9: who confirms what", () => {
    it("lets only Ana confirm a debit from her Bancolombia account: Juan answers AccountNotOwned (D9)", async () => {
      const { confirm, ref, store, recurrences } = await pendingElectricity();
      expect([
        codeOf(await confirm({ ...ref("u-juan"), amount: cop(205_300n) })),
        store.rows,
        recurrences.occurrenceRows[0]!.status,
      ]).toEqual(["AccountNotOwned", [], "PENDING"]);
    });

    it("lets anyone who records money confirm a fund-paid or a guest-paid one, as themselves (D15, P21)", async () => {
      const w = materializerWorld({ weights: home });
      const water = await w.define(electricity({ description: "Water", template: paidFromTheFund }));
      const gas = await w.define(electricity({ description: "Gas", template: paidByPedro }));
      await w.run("2026-12-10");
      const confirm = createConfirmOccurrence(w.deps);
      const of = (recurrenceId: string) =>
        w.recurrences.occurrenceRows.find((o) => o.recurrenceId === recurrenceId)!;
      const ref = (userId: string, recurrenceId: string) => ({
        spaceId: "space-household",
        userId,
        occurrenceId: of(recurrenceId).id,
      });
      unwrap(await confirm({ ...ref("u-luis", water.id), amount: cop(90_000n) }));
      unwrap(await confirm({ ...ref("u-juan", gas.id), amount: cop(50_000n) }));
      expect(w.store.rows.map((t) => [t.description, t.createdBy])).toEqual([
        ["Water", "u-luis"],
        ["Gas", "u-juan"],
      ]);
      expect(w.recurrences.occurrenceRows.map((o) => [o.status, o.resolvedBy])).toEqual([
        ["RECORDED", "u-luis"],
        ["RECORDED", "u-juan"],
      ]);
    });
  });

  it("answers OccurrenceNotFound alike for another space's, an unknown and a malformed occurrence, on confirm and on skip", async () => {
    const { confirm, skip, ref, store, recurrences } = await pendingElectricity();
    const amount = cop(1n);
    // Ana is OWNER of space-ana too, where the Household occurrence does not exist.
    const elsewhere = { ...ref(), spaceId: "space-ana" };
    const answers = [
      await skip(elsewhere),
      await confirm({ ...elsewhere, amount }),
      await confirm({ ...ref(), occurrenceId: "occ-unknown", amount }),
      await confirm({ ...ref(), occurrenceId: "not-an-occurrence", amount }),
    ];
    expect(answers).toEqual(answers.map(() => ({ ok: false, error: { code: "OccurrenceNotFound" } })));
    expect([store.rows, recurrences.occurrenceRows[0]!.status]).toEqual([[], "PENDING"]);
  });

  it("answers SpaceNotFound to someone who is not in the space, on confirm and on skip", async () => {
    const { confirm, skip, ref, store, recurrences } = await pendingElectricity();
    expect([
      codeOf(await confirm({ ...ref("u-nobody"), amount: cop(205_300n) })),
      codeOf(await skip(ref("u-nobody"))),
      store.rows,
      recurrences.occurrenceRows[0]!.status,
    ]).toEqual(["SpaceNotFound", "SpaceNotFound", [], "PENDING"]);
  });

  it("records who resolved the occurrence and when, at the clock's instant: Juan skips Ana's fund-paid Water, Luis confirms Pedro's Gas", async () => {
    const w = materializerWorld({ weights: home });
    const water = await w.define(electricity({ description: "Water", template: paidFromTheFund }));
    const gas = await w.define(electricity({ description: "Gas", template: paidByPedro }));
    await w.run("2026-12-10");
    w.clock.set("2026-12-11");
    const resolvedAt = w.clock.now();
    const of = (recurrenceId: string) =>
      w.recurrences.occurrenceRows.find((o) => o.recurrenceId === recurrenceId)!;
    const ref = (userId: string, recurrenceId: string) => ({
      spaceId: "space-household",
      userId,
      occurrenceId: of(recurrenceId).id,
    });
    const skipped = unwrap(await createSkipOccurrence(w.deps)(ref("u-juan", water.id)));
    const confirmed = unwrap(
      await createConfirmOccurrence(w.deps)({ ...ref("u-luis", gas.id), amount: cop(50_000n) }),
    );
    // Ana created both, so only the requester can be the one who resolved them.
    expect([
      [skipped.occurrence.resolvedBy, skipped.occurrence.resolvedAt],
      [confirmed.occurrence.resolvedBy, confirmed.occurrence.resolvedAt],
      w.recurrences.occurrenceRows.map((o) => [o.status, o.resolvedBy, o.resolvedAt]),
    ]).toEqual([
      ["u-juan", resolvedAt],
      ["u-luis", resolvedAt],
      [
        ["SKIPPED", "u-juan", resolvedAt],
        ["RECORDED", "u-luis", resolvedAt],
      ],
    ]);
  });

  it("can still confirm or skip the pending occurrences of an ended or a paused recurrence: they were due before it stopped", async () => {
    const w = materializerWorld({ weights: home });
    const power = await w.define(electricity());
    const water = await w.define(
      electricity({ description: "Water", schedule: { kind: "MONTHLY", day: 20 } }),
    );
    await w.run("2026-12-20");
    w.clock.set("2026-12-21");
    const manage = (recurrenceId: string) => ({ spaceId: "space-household", userId: "u-ana", recurrenceId });
    unwrap(await createEndRecurrence(w.deps)(manage(power.id)));
    unwrap(await createPauseRecurrence(w.deps)(manage(water.id)));
    const list = createListPendingOccurrences(w.deps);
    const pending = unwrap(await list({ spaceId: "space-household", userId: "u-ana" }));
    expect(pending.map((p) => [p.occurrence.date, p.recurrence.id, statusOf(p.recurrence)])).toEqual([
      ["2026-12-10", power.id, "ENDED"],
      ["2026-12-20", water.id, "PAUSED"],
    ]);
    const [ended, paused] = pending.map((p) => ({
      spaceId: "space-household",
      userId: "u-ana",
      occurrenceId: p.occurrence.id,
    }));
    const confirmed = unwrap(await createConfirmOccurrence(w.deps)({ ...ended!, amount: cop(205_300n) }));
    const skipped = unwrap(await createSkipOccurrence(w.deps)(paused!));
    expect([
      confirmed.occurrence.status,
      confirmed.transaction.date,
      skipped.occurrence.status,
      w.store.rows.length,
      pending.map((p) => statusOf(p.recurrence)),
    ]).toEqual(["RECORDED", "2026-12-10", "SKIPPED", 1, ["ENDED", "PAUSED"]]);
  });

  it("refuses to confirm or skip in an archived space with SpaceArchived, and still lists what is pending (HU-E1-09)", async () => {
    const { confirm, skip, list, ref, spaces, store, recurrences } = await pendingElectricity();
    await spaces.archive("space-household");
    expect([
      codeOf(await confirm({ ...ref(), amount: cop(205_300n) })),
      codeOf(await skip(ref())),
      store.rows,
      recurrences.occurrenceRows[0]!.status,
    ]).toEqual(["SpaceArchived", "SpaceArchived", [], "PENDING"]);
    const pending = unwrap(await list({ spaceId: "space-household", userId: "u-luis" }));
    expect(pending.map((p) => [p.occurrence.date, p.occurrence.status])).toEqual([["2026-12-10", "PENDING"]]);
  });

  describe("the obligations of recordOccurrence (Task 8a)", () => {
    it("records the confirmed occurrence and writes its row in the one transaction that holds its lock, as the member who confirms, and commits it", async () => {
      const w = await pendingOccurrences({}, electricity({ template: paidFromTheFund }));
      const confirm = createConfirmOccurrence(traced(w));
      unwrap(await confirm({ ...w.ref("u-luis"), amount: cop(205_300n) }));
      expect(w.tm.events).toEqual([
        "begin",
        "lock occurrence",
        "record 2026-12-10 as u-luis",
        "save 2026-12-10 RECORDED",
        "commit",
      ]);
    });

    it("skips in the one transaction that holds the occurrence's lock, and commits it", async () => {
      const w = await pendingElectricity();
      const skip = createSkipOccurrence(traced(w));
      unwrap(await skip(w.ref("u-luis")));
      expect(w.tm.events).toEqual(["begin", "lock occurrence", "save 2026-12-10 SKIPPED", "commit"]);
    });

    it("decides on the occurrence it read under the lock: a second confirm or skip records nothing, and writes nothing", async () => {
      const w = await pendingElectricity();
      const deps = traced(w);
      unwrap(await createConfirmOccurrence(deps)({ ...w.ref(), amount: cop(205_300n) }));
      w.tm.events.length = 0;
      expect([
        codeOf(await createConfirmOccurrence(deps)({ ...w.ref(), amount: cop(1n) })),
        codeOf(await createSkipOccurrence(deps)(w.ref())),
        w.tm.events,
        w.store.rows.length,
      ]).toEqual([
        "OccurrenceNotPending",
        "OccurrenceNotPending",
        ["begin", "lock occurrence", "rollback", "begin", "lock occurrence", "rollback"],
        1,
      ]);
    });

    it("aborts the transaction on a refusal: the occurrence stays PENDING and no transaction exists, even if the ledger had written one", async () => {
      const w = await pendingElectricity();
      const deps = traced(w);
      const confirm = createConfirmOccurrence({
        ...deps,
        recorders: {
          ...deps.recorders,
          // The ledger refuses before it writes; a nested refusal does not roll anything back by itself.
          expense: async (input) => {
            unwrap(await w.deps.recorders.expense(input));
            return err(domainError("PeriodClosed"));
          },
        },
      });
      expect([
        codeOf(await confirm({ ...w.ref(), amount: cop(205_300n) })),
        w.tm.events,
        w.store.rows,
        w.recurrences.occurrenceRows[0]!.status,
      ]).toEqual(["PeriodClosed", ["begin", "lock occurrence", "rollback"], [], "PENDING"]);
    });

    it("aborts it on the ledger's own refusal too, before the occurrence is written", async () => {
      let closed = false;
      const w = await pendingElectricity({ closed: () => closed });
      closed = true;
      const confirm = createConfirmOccurrence(traced(w));
      expect([codeOf(await confirm({ ...w.ref(), amount: cop(205_300n) })), w.tm.events]).toEqual([
        "PeriodClosed",
        ["begin", "lock occurrence", "record 2026-12-10 as u-ana", "rollback"],
      ]);
    });

    it("rolls the recorded transaction back with it when the occurrence cannot be written", async () => {
      const w = await pendingElectricity();
      const deps = traced(w);
      w.recurrences.saveOccurrence = async () => {
        throw new Error("write failed");
      };
      await expect(createConfirmOccurrence(deps)({ ...w.ref(), amount: cop(205_300n) })).rejects.toThrow(
        "write failed",
      );
      expect([w.store.rows, w.recurrences.occurrenceRows[0]!.status, w.tm.events.at(-1)]).toEqual([
        [],
        "PENDING",
        "rollback",
      ]);
    });
  });
});
