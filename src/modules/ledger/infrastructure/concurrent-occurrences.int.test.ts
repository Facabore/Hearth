import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, type LocalDate, type Result } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { codeOf, fixedTimeZones, money, unwrap } from "../../../../tests/support/fakes";
import {
  categoryFixture,
  sharedLedgerFixture,
  type SharedLedgerFixture,
} from "../../../../tests/support/fixtures";
import { bothSettled, heldBy, holder, outcomesOf } from "../../../../tests/support/locks";
import { createDefineRecurrence, type DefineRecurrenceInput } from "../application/define-recurrence";
import type { LedgerDeps } from "../application/deps";
import {
  createEndRecurrence,
  createPauseRecurrence,
  createUpdateRecurrence,
} from "../application/manage-recurrence";
import { createMaterializeDueOccurrences } from "../application/materialize-occurrences";
import type { MaterializeDeps } from "../application/materialize-recurrence";
import { createConfirmOccurrence, createSkipOccurrence } from "../application/pending-occurrences";
import { occurrenceRecorders, type OccurrenceRecorders } from "../application/record-occurrence";
import type { OccurrenceRepository, RecurrenceRepository } from "../application/recurrence-ports";
import { statusOf } from "../domain/recurrence";
import { DrizzleAuditLog } from "./drizzle-audit-log";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleRecurrenceRepository } from "./drizzle-recurrence-repository";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleRecurrenceRepository(tm);
const spaces = new DrizzleSpaceRepository(tm);
const accounts = new DrizzleAccountRepository(tm);
const categories = new DrizzleCategoryRepository(tm);

afterAll(() => pool.end());

const day = (iso: string) => iso as LocalDate;
type Holder = ReturnType<typeof holder>;
type Scope = Parameters<typeof deps>[0];

/** The ledger's deps over PostgreSQL as the composition root builds them, with no plan: every period open, EQUAL. */
const ledgerDeps = (): LedgerDeps => ({
  access: createSpaceAccess(spaces),
  members: spaces,
  transactions: new DrizzleTransactionRepository(tm),
  query: new DrizzleLedgerQueries(tm),
  audit: new DrizzleAuditLog(tm),
  accounts: {
    find: async (accountId) => {
      const account = await accounts.findById(accountId);
      return account
        ? {
            id: account.id,
            spaceId: account.spaceId,
            ownerUserId: account.ownerUserId,
            isSharedFund: account.type === "SHARED_FUND",
            archived: account.archivedAt !== null,
          }
        : null;
    },
  },
  accountBalances: { balanceOf: async () => 0n },
  categories: {
    find: async (spaceId, categoryId) => {
      const category = (await categories.listCategories(spaceId)).find((c) => c.id === categoryId);
      return category ? { id: category.id, archived: category.archivedAt !== null } : null;
    },
    subcategoriesOf: async () => [],
  },
  closedPeriods: { isClosed: async () => false },
  defaultSplits: { allocationWeights: async () => null },
  storedPeriods: async () => [],
  ids: new UuidV7IdGenerator(),
  clock: new FixedClock(new Date("2026-10-28T17:00:00Z")),
  timeZone: "America/Bogota",
  userTimeZones: fixedTimeZones(),
  tm,
});

/**
 * The deps of the recurrence use cases over PostgreSQL. The scheduler sees only `recurrenceId` (other files share the
 * database); `recurrences`, `occurrences` and `recorders` replace what a test intercepts.
 */
const deps = (
  scope: {
    readonly recurrenceId?: string;
    readonly recurrences?: Partial<RecurrenceRepository>;
    readonly occurrences?: Partial<OccurrenceRepository>;
    readonly recorders?: (recorders: OccurrenceRecorders) => OccurrenceRecorders;
  } = {},
): MaterializeDeps => {
  const ledger = ledgerDeps();
  const recurrences: RecurrenceRepository = {
    add: (r) => repo.add(r),
    find: (spaceId, id) => repo.find(spaceId, id),
    list: (spaceId) => repo.list(spaceId),
    lockForWrite: (spaceId, id) => repo.lockForWrite(spaceId, id),
    save: (r) => repo.save(r),
    listActive: async (today) => (await repo.listActive(today)).filter((a) => a.id === scope.recurrenceId),
    ...scope.recurrences,
  };
  const occurrences: OccurrenceRepository = {
    addOccurrence: (o) => repo.addOccurrence(o),
    saveOccurrence: (o) => repo.saveOccurrence(o),
    findOccurrence: (spaceId, id, options) => repo.findOccurrence(spaceId, id, options),
    pendingOccurrences: (spaceId) => repo.pendingOccurrences(spaceId),
    latestOccurrences: (spaceId, ids) => repo.latestOccurrences(spaceId, ids),
    ...scope.occurrences,
  };
  const recorders = occurrenceRecorders(ledger);
  return { ...ledger, recurrences, occurrences, recorders: scope.recorders?.(recorders) ?? recorders };
};

/** Household's "Rent", 1,200,000 COP from its fund, MONTHLY(1), AUTO, from 2026-12-01, defined by Ana. */
const rentOf = (
  w: SharedLedgerFixture,
  overrides: Partial<DefineRecurrenceInput> = {},
): DefineRecurrenceInput => ({
  spaceId: w.household.spaceId,
  userId: w.household.userId,
  description: "Rent",
  amount: money(120_000_000n),
  template: {
    type: "EXPENSE",
    categoryId: w.groceries,
    payer: { memberId: null, accountId: w.fund },
    split: null,
  },
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: day("2026-12-01"),
  endDate: null,
  ...overrides,
});

/**
 * The recurrences the running test defined. The scheduler's job handles every active recurrence of its database, and a
 * shared `TEST_DATABASE_URL` is also the acceptance suites' database, so each test ends (logically, D8) what it defined.
 */
const defined: { readonly spaceId: string; readonly userId: string; readonly id: string }[] = [];

/** Defines a recurrence by `rentOf(w, overrides)` and remembers it for `afterEach`. */
const define = async (w: SharedLedgerFixture, overrides: Partial<DefineRecurrenceInput> = {}) => {
  const { recurrence } = unwrap(await createDefineRecurrence(deps())(rentOf(w, overrides)));
  defined.push({ spaceId: recurrence.spaceId, userId: recurrence.createdBy, id: recurrence.id });
  return recurrence;
};

afterEach(async () => {
  const mine = defined.splice(0);
  const failures: unknown[] = [];
  for (const { spaceId, userId, id } of mine) {
    try {
      // One the test ended already (or that ran out of dates) is ENDED, and ending an ENDED one is refused.
      const stored = await repo.find(spaceId, id);
      if (stored !== null && statusOf(stored) !== "ENDED") {
        const ended = await createEndRecurrence(deps())({ spaceId, userId, recurrenceId: id });
        if (!ended.ok) throw new Error(`ending ${id} answered ${ended.error.code}`);
      }
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} of ${mine.length} recurrences were not ended`);
  }
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM recurrences WHERE id = ANY($1) AND ended_at IS NULL",
    [mine.map((recurrence) => recurrence.id)],
  );
  expect(rows[0].n).toBe(0);
});

/*
 * Every race here stops one transaction inside its work, holding its locks and uncommitted rows, until the other
 * queues behind a lock it holds or finishes without queueing (`holder`). Which lock is pinned by which test:
 *  - the recurrence's row lock (`lockForWrite`): the two-runs test, then each run and member write in both orders;
 *  - the occurrence's row lock (`findOccurrence` with `lock`): the confirm and the skip, in both orders;
 *  - the unique key `recurrence_occurrences_date_uq` alone: the second two-runs test, which takes the lock away.
 */

/** The recorders whose expense stops in `h.hold()` once recorded: the run keeps its row lock and uncommitted work. */
const stoppingAfterExpense =
  (h: Holder) =>
  (recorders: OccurrenceRecorders): OccurrenceRecorders => ({
    ...recorders,
    expense: async (input) => {
      const recorded = await recorders.expense(input);
      await h.hold();
      return recorded;
    },
  });

/** A recurrence save that stops in `h.hold()` once the row is written: the writer keeps the row lock. */
const stoppingAfterSave = (h: Holder): Partial<RecurrenceRepository> => ({
  save: async (recurrence) => {
    await repo.save(recurrence);
    await h.hold();
  },
});

/** An occurrence save that stops in `h.hold()` once the row is written: the writer keeps the occurrence's lock. */
const stoppingAfterOccurrenceSave = (h: Holder): Partial<OccurrenceRepository> => ({
  saveOccurrence: async (occurrence) => {
    await repo.saveOccurrence(occurrence);
    await h.hold();
  },
});

/** What the expenses of Household recorded, as minor units, in the order they were recorded. */
const expensesOf = async (w: SharedLedgerFixture): Promise<string[]> => {
  const { rows } = await pool.query(
    "SELECT amount::text AS amount FROM transactions WHERE space_id = $1 AND type = 'EXPENSE' ORDER BY created_at, id",
    [w.household.spaceId],
  );
  return rows.map((row) => row.amount as string);
};

const occurrencesOf = async (w: SharedLedgerFixture): Promise<string[]> => {
  const { rows } = await pool.query(
    "SELECT occurrence_date::text AS date, status FROM recurrence_occurrences WHERE space_id = $1 ORDER BY occurrence_date",
    [w.household.spaceId],
  );
  return rows.map((row) => `${row.date as string} ${row.status as string}`);
};

/** The recurrence as the next reader finds it, with the expenses recorded in its space: what a race left behind. */
const stateOf = async (w: SharedLedgerFixture, recurrenceId: string) => {
  const stored = (await repo.find(w.household.spaceId, recurrenceId))!;
  return {
    status: statusOf(stored),
    dueFrom: stored.dueFrom,
    amount: stored.amount.toString(),
    recorded: await expensesOf(w),
  };
};

/** The Rent, and the scheduler's job over it alone on 2026-12-01; with `h` the job stops once it recorded the Rent. */
const rentFixture = async () => {
  const w = await sharedLedgerFixture(db, pool);
  const rent = await define(w);
  const ref = { spaceId: w.household.spaceId, userId: w.household.userId, recurrenceId: rent.id };
  const run = (h?: Holder, scope: Scope = {}) =>
    createMaterializeDueOccurrences(
      deps({ recurrenceId: rent.id, ...(h ? { recorders: stoppingAfterExpense(h) } : {}), ...scope }),
    )({ today: day("2026-12-01") });
  return { w, rent, ref, run };
};

describe("two runs of the job (HU-E4-12, Review Focus 1)", () => {
  it("records the 2026-12-01 Rent once when two runs meet: the second waits for the first's lock and sees its dueFrom", async () => {
    const { w, run } = await rentFixture();
    const h = holder(tm, pool);
    // The first run stops inside its transaction once it recorded the Rent, holding the recurrence's row lock.
    const first = run(h);
    await heldBy(h, first);
    const second = run().finally(h.release);
    const [a, b] = await bothSettled(first, second);
    expect([a.occurrences.length, b.occurrences.length, a.failures, b.failures]).toEqual([1, 0, [], []]);
    expect(await expensesOf(w)).toEqual(["120000000"]);
    expect(await occurrencesOf(w)).toEqual(["2026-12-01 RECORDED"]);
  });

  // The test above pins the lock: without it the second run commits first and the first reports a failure. This one
  // pins the unique key, which stands behind the lock: it takes the lock away and the data still holds one Rent.
  it("refuses a second occurrence of a date by the unique key alone when no lock is taken, rolling the held run back", async () => {
    const { w, rent, run } = await rentFixture();
    const unlocked = {
      recurrences: { lockForWrite: (spaceId: string, id: string) => repo.find(spaceId, id) },
    };
    const h = holder(tm, pool);
    const first = run(h, unlocked);
    await heldBy(h, first);
    const second = run(undefined, unlocked).finally(h.release);
    const [a, b] = await bothSettled(first, second);
    // Nobody waited: the second committed first, and the held first run then collided on the date.
    expect([a.occurrences, b.occurrences.length, b.failures]).toEqual([[], 1, []]);
    expect(a.failures).toMatchObject([
      { recurrenceId: rent.id, code: "23505", constraint: "recurrence_occurrences_date_uq" },
    ]);
    // The held run's own expense went with its transaction.
    expect(await expensesOf(w)).toEqual(["120000000"]);
    expect(await occurrencesOf(w)).toEqual(["2026-12-01 RECORDED"]);
  });
});

describe("a run and a member's write take turns on the recurrence's row lock (HU-E4-11, HU-E4-12, Review Focus 1)", () => {
  const rented = "120000000";
  const raised = "130000000";
  type State = Awaited<ReturnType<typeof stateOf>>;
  interface Case {
    readonly name: string;
    readonly write: (
      deps: MaterializeDeps,
      ref: { spaceId: string; userId: string; recurrenceId: string },
    ) => Promise<Result<unknown>>;
    /** The write first, then the run; and the run first, then the write. Any other state is a mix of the two. */
    readonly writeThenRun: State;
    readonly runThenWrite: State;
  }
  // A run records 2026-12-01 and moves the cursor to the day after it (2026-12-02).
  const cases: Case[] = [
    {
      name: "pause",
      write: (d, ref) => createPauseRecurrence(d)(ref),
      // The run saw the pause and recorded nothing; the pause saw what the run committed and kept it.
      writeThenRun: { status: "PAUSED", dueFrom: day("2026-12-01"), amount: rented, recorded: [] },
      runThenWrite: { status: "PAUSED", dueFrom: day("2026-12-02"), amount: rented, recorded: [rented] },
    },
    {
      name: "end",
      write: (d, ref) => createEndRecurrence(d)(ref),
      writeThenRun: { status: "ENDED", dueFrom: day("2026-12-01"), amount: rented, recorded: [] },
      runThenWrite: { status: "ENDED", dueFrom: day("2026-12-02"), amount: rented, recorded: [rented] },
    },
    {
      name: "edit",
      write: (d, ref) => createUpdateRecurrence(d)({ ...ref, changes: { amount: money(130_000_000n) } }),
      // The run records the amount it finds under the lock: the raised one if the edit came first, else the Rent.
      writeThenRun: { status: "ACTIVE", dueFrom: day("2026-12-02"), amount: raised, recorded: [raised] },
      runThenWrite: { status: "ACTIVE", dueFrom: day("2026-12-02"), amount: raised, recorded: [rented] },
    },
  ];

  it.each(cases)("makes a run wait for a member's $name in progress, which it then sees", async (c) => {
    const { w, rent, ref, run } = await rentFixture();
    const h = holder(tm, pool);
    // The write stops inside its transaction once it saved the recurrence, holding its row lock.
    const writing = c.write(deps({ recurrences: stoppingAfterSave(h) }), ref);
    await heldBy(h, writing);
    const running = run().finally(h.release);
    const [written, report] = await bothSettled(writing, running);
    expect([codeOf(written), report.failures]).toEqual(["ok", []]);
    expect(await stateOf(w, rent.id)).toEqual(c.writeThenRun);
  });

  it.each(cases)("makes a member's $name wait for a run in progress, which it then follows", async (c) => {
    const { w, rent, ref, run } = await rentFixture();
    const h = holder(tm, pool);
    // The run stops inside its transaction once it recorded the Rent, holding the row lock before it saves the cursor.
    const running = run(h);
    await heldBy(h, running);
    const writing = c.write(deps(), ref).finally(h.release);
    const [report, written] = await bothSettled(running, writing);
    expect([codeOf(written), report.failures]).toEqual(["ok", []]);
    expect(await stateOf(w, rent.id)).toEqual(c.runThenWrite);
  });
});

describe("a confirmation, a skip and an edit (HU-E4-13, Review Focus 1)", () => {
  /** "Electricity", CONFIRM, MONTHLY(10), paid by Ana from her account; its 2026-12-10 occurrence is pending. */
  const pendingElectricity = async () => {
    const w = await sharedLedgerFixture(db, pool);
    const electricity = await define(w, {
      description: "Electricity",
      mode: "CONFIRM",
      schedule: { kind: "MONTHLY", day: 10 },
      template: {
        type: "EXPENSE",
        categoryId: w.groceries,
        payer: { memberId: w.household.memberId, accountId: w.bank },
        split: null,
      },
    });
    await createMaterializeDueOccurrences(deps({ recurrenceId: electricity.id }))({
      today: day("2026-12-10"),
    });
    const [pending] = await repo.pendingOccurrences(w.household.spaceId);
    const ref = { spaceId: w.household.spaceId, userId: w.household.userId, occurrenceId: pending!.id };
    const statusNow = async () => (await repo.findOccurrence(w.household.spaceId, pending!.id))?.status;
    return { w, electricity, ref, statusNow };
  };
  const confirmed = money(20_530_000n);

  it("lets a confirm and a skip of one pending occurrence take turns: the confirm first, the skip answers OccurrenceNotPending", async () => {
    const { w, ref, statusNow } = await pendingElectricity();
    const h = holder(tm, pool);
    // The confirmation stops inside its transaction once it saved the RECORDED occurrence, holding its row lock.
    const confirming = createConfirmOccurrence(deps({ occurrences: stoppingAfterOccurrenceSave(h) }))({
      ...ref,
      amount: confirmed,
    });
    await heldBy(h, confirming);
    const skipping = createSkipOccurrence(deps())(ref).finally(h.release);
    expect(await outcomesOf(confirming, skipping)).toEqual(["OccurrenceNotPending", "ok"]);
    expect([await statusNow(), await expensesOf(w)]).toEqual(["RECORDED", ["20530000"]]);
  });

  it("lets a confirm and a skip of one pending occurrence take turns: the skip first, the confirm answers OccurrenceNotPending", async () => {
    const { w, ref, statusNow } = await pendingElectricity();
    const h = holder(tm, pool);
    // The skip stops inside its transaction once it saved the SKIPPED occurrence, holding its row lock.
    const skipping = createSkipOccurrence(deps({ occurrences: stoppingAfterOccurrenceSave(h) }))(ref);
    await heldBy(h, skipping);
    const confirming = createConfirmOccurrence(deps())({ ...ref, amount: confirmed }).finally(h.release);
    expect(await outcomesOf(skipping, confirming)).toEqual(["OccurrenceNotPending", "ok"]);
    expect([await statusNow(), await expensesOf(w)]).toEqual(["SKIPPED", []]);
  });

  // A confirmation reads its recurrence without the row lock (Task 10): the template it records is what one read
  // gave it, a whole version of the row, so the description and the category of one edit never come from two.
  describe("a confirm racing an edit of its recurrence", () => {
    const stops = {
      // Right after it read the recurrence: the edit commits before the confirmation records.
      "after it read the recurrence": (h: Holder): Scope => ({
        recurrences: {
          find: async (spaceId, id) => {
            const read = await repo.find(spaceId, id);
            await h.hold();
            return read;
          },
        },
      }),
      // Right after it locked the occurrence: the edit commits before the confirmation reads the recurrence.
      "before it reads the recurrence": (h: Holder): Scope => ({
        occurrences: {
          findOccurrence: async (spaceId, id, options) => {
            const locked = await repo.findOccurrence(spaceId, id, options);
            await h.hold();
            return locked;
          },
        },
      }),
    };

    /** What the confirmation recorded and what the recurrence holds afterwards, as [description, category name]. */
    const confirmedWhileEdited = async (stop: keyof typeof stops) => {
      const { w, electricity, ref } = await pendingElectricity();
      const utilities = await categoryFixture(db, w.household, "Utilities");
      const h = holder(tm, pool);
      const confirming = createConfirmOccurrence(deps(stops[stop](h)))({ ...ref, amount: confirmed });
      await heldBy(h, confirming);
      // Waits for nobody, so it commits and releases the confirmation.
      const editing = createUpdateRecurrence(deps())({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
        recurrenceId: electricity.id,
        changes: { description: "Electricity bill", categoryId: utilities },
      }).finally(h.release);
      expect(await outcomesOf(confirming, editing)).toEqual(["ok", "ok"]);
      const pair = (row: { description: string; name: string }) => [row.description, row.name];
      const recorded = await pool.query(
        "SELECT t.description, c.name FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.space_id = $1",
        [w.household.spaceId],
      );
      const stored = await pool.query(
        "SELECT r.description, c.name FROM recurrences r JOIN categories c ON c.id = r.category_id WHERE r.id = $1",
        [electricity.id],
      );
      return { recorded: recorded.rows.map(pair), stored: stored.rows.map(pair) };
    };

    it("records the pre-edit template whole when the edit commits after the confirmation read the recurrence", async () => {
      expect(await confirmedWhileEdited("after it read the recurrence")).toEqual({
        recorded: [["Electricity", "Groceries"]],
        stored: [["Electricity bill", "Utilities"]],
      });
    });

    it("records the post-edit template whole when the edit commits before the confirmation reads the recurrence", async () => {
      expect(await confirmedWhileEdited("before it reads the recurrence")).toEqual({
        recorded: [["Electricity bill", "Utilities"]],
        stored: [["Electricity bill", "Utilities"]],
      });
    });
  });
});
