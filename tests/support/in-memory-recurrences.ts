import {
  createDefineRecurrence,
  createMaterializeDueOccurrences,
  occurrenceRecorders,
  type ActiveRecurrence,
  type DefineRecurrenceInput,
  type MaterializeDeps,
  type Occurrence,
  type OccurrenceRepository,
  type Recurrence,
  type RecurrenceDeps,
  type RecurrenceRepository,
  type RecurrenceTemplate,
} from "@/modules/ledger/application";
import { createSpaceAccess, type Space, type SpaceId } from "@/modules/spaces/application";
import { Money, type Clock, type LocalDate, type Result, type TransactionManager } from "@/shared/kernel";
import { unwrap } from "./fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "./in-memory-ledger";
import { HOUSEHOLD_MEMBERS, householdSpace, InMemorySpaceStore, memberOf } from "./in-memory-spaces";

/** The template as it was defined, with the category and split an edit may change taken from `next` (ruling P22). */
const editedTemplate = (stored: RecurrenceTemplate, next: RecurrenceTemplate): RecurrenceTemplate =>
  stored.type === "EXPENSE" && next.type === "EXPENSE"
    ? { ...stored, categoryId: next.categoryId, split: next.split }
    : stored.type === "INCOME" && next.type === "INCOME"
      ? { ...stored, categoryId: next.categoryId }
      : stored;

/** The order the adapter answers in: when they were created, then by id. */
const definedFirst = (a: Recurrence, b: Recurrence) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The order the adapter lists occurrences in: earliest date first, then by id. */
const earliestFirst = (a: Occurrence, b: Occurrence) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Recurrences and occurrences over arrays; recurrences.int.test.ts runs the same sequences against PostgreSQL. */
export class InMemoryRecurrences implements RecurrenceRepository, OccurrenceRepository {
  rows: Recurrence[] = [];
  occurrenceRows: Occurrence[] = [];
  /** Ids read with lockForWrite, in order. */
  readonly locked: string[] = [];

  async add(recurrence: Recurrence) {
    this.rows.push(recurrence);
  }

  async find(spaceId: string, recurrenceId: string) {
    return this.rows.find((r) => r.id === recurrenceId && r.spaceId === spaceId) ?? null;
  }

  async list(spaceId: string) {
    return this.rows.filter((r) => r.spaceId === spaceId).sort(definedFirst);
  }

  async lockForWrite(spaceId: string, recurrenceId: string) {
    this.locked.push(recurrenceId);
    return this.find(spaceId, recurrenceId);
  }

  async save(recurrence: Recurrence) {
    const isStored = (stored: Recurrence) =>
      stored.id === recurrence.id &&
      stored.spaceId === recurrence.spaceId &&
      stored.template.type === recurrence.template.type;
    if (!this.rows.some(isStored)) {
      throw new Error(`recurrence ${recurrence.id} (${recurrence.template.type}) is not stored in its space`);
    }
    this.rows = this.rows.map((stored) =>
      isStored(stored)
        ? {
            ...stored,
            description: recurrence.description,
            amount: recurrence.amount,
            template: editedTemplate(stored.template, recurrence.template),
            schedule: recurrence.schedule,
            mode: recurrence.mode,
            endDate: recurrence.endDate,
            dueFrom: recurrence.dueFrom,
            pausedAt: recurrence.pausedAt,
            pauseReason: recurrence.pauseReason,
            endedAt: recurrence.endedAt,
            updatedAt: recurrence.updatedAt,
          }
        : stored,
    );
  }

  async listActive(today: LocalDate): Promise<ActiveRecurrence[]> {
    return [...this.rows]
      .sort(definedFirst)
      .filter(
        (r) =>
          r.pausedAt === null &&
          r.endedAt === null &&
          r.dueFrom <= today &&
          (r.endDate === null || r.dueFrom <= r.endDate),
      )
      .map((r) => ({ id: r.id, spaceId: r.spaceId }));
  }

  async addOccurrence(occurrence: Occurrence) {
    // recurrence_occurrences_date_uq
    if (
      this.occurrenceRows.some(
        (o) => o.recurrenceId === occurrence.recurrenceId && o.date === occurrence.date,
      )
    ) {
      // As Drizzle reports the unique index: an Error whose cause is the database's, with its SQLSTATE and constraint.
      throw new Error(`duplicate occurrence of ${occurrence.recurrenceId} on ${occurrence.date}`, {
        cause: { code: "23505", constraint: "recurrence_occurrences_date_uq" },
      });
    }
    this.occurrenceRows.push(occurrence);
  }

  async saveOccurrence(occurrence: Occurrence) {
    const isStored = (stored: Occurrence) =>
      stored.id === occurrence.id && stored.spaceId === occurrence.spaceId;
    if (!this.occurrenceRows.some(isStored)) {
      throw new Error(`occurrence ${occurrence.id} is not stored in its space`);
    }
    // As the adapter: the recurrence, the date and the creation stay as stored.
    this.occurrenceRows = this.occurrenceRows.map((stored) =>
      isStored(stored)
        ? {
            ...stored,
            status: occurrence.status,
            amount: occurrence.amount,
            transactionId: occurrence.transactionId,
            reason: occurrence.reason,
            resolvedBy: occurrence.resolvedBy,
            resolvedAt: occurrence.resolvedAt,
          }
        : stored,
    );
  }

  async findOccurrence(spaceId: string, occurrenceId: string) {
    return this.occurrenceRows.find((o) => o.id === occurrenceId && o.spaceId === spaceId) ?? null;
  }

  async pendingOccurrences(spaceId: string) {
    return this.occurrenceRows
      .filter((o) => o.spaceId === spaceId && o.status === "PENDING")
      .sort(earliestFirst);
  }

  async latestOccurrences(spaceId: string, recurrenceIds: readonly string[]) {
    const latest = new Map<string, Occurrence>();
    for (const o of this.occurrenceRows) {
      if (o.spaceId !== spaceId || !recurrenceIds.includes(o.recurrenceId)) continue;
      const seen = latest.get(o.recurrenceId);
      if (seen === undefined || o.date > seen.date) latest.set(o.recurrenceId, o);
    }
    return latest;
  }
}

/** A clock the test moves: `clock.set("2026-12-20")` makes it noon of that day in Bogotá. */
export class MovableClock implements Clock {
  private instant: Date;

  constructor(day: string) {
    this.instant = MovableClock.noonOf(day);
  }

  set(day: string): void {
    this.instant = MovableClock.noonOf(day);
  }

  now(): Date {
    return new Date(this.instant);
  }

  private static noonOf(day: string): Date {
    return new Date(`${day}T17:00:00Z`);
  }
}

/** Ana's personal space (`space-ana`, COP, MONTHLY(1)), where her accounts and her salary category live. */
const anasPersonalSpace = (): Space => ({
  id: "space-ana" as SpaceId,
  name: "Personal",
  kind: "PERSONAL",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  personalOwnerUserId: "u-ana",
  members: [memberOf("Ana", "OWNER", 0)],
  createdAt: new Date("2026-10-01T12:00:00Z"),
});

/**
 * Household (HU-E1-05 Background: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi, the guest Pedro) and Ana's
 * personal space as the recurrence use cases see them, on 2026-10-28 in Bogotá until the test moves `clock`.
 */
export const recurrenceWorld = () => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace(HOUSEHOLD_MEMBERS));
  spaces.seed(anasPersonalSpace());
  const clock = new MovableClock("2026-10-28");
  const recurrences = new InMemoryRecurrences();
  const { deps: ledger, store } = ledgerFixture({
    access: createSpaceAccess(spaces),
    members: spaces,
    clock,
  });
  const deps: RecurrenceDeps = { ...ledger, recurrences, occurrences: recurrences };
  return { deps, spaces, clock, recurrences, store };
};

/** HU-E4-11: Ana defines "Rent", 1,200,000 COP of Household paid from the Household Fund, MONTHLY(1), AUTO, from 2026-12-01. */
export const rentDefinition = (overrides: Partial<DefineRecurrenceInput> = {}): DefineRecurrenceInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Rent",
  amount: unwrap(Money.ofMinor(120_000_000n, "COP")),
  template: {
    type: "EXPENSE",
    categoryId: CATEGORIES.household.id,
    payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
    split: null,
  },
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: "2026-12-01" as LocalDate,
  endDate: null,
  ...overrides,
});

/**
 * A transaction manager over the in-memory stores that does for one transaction at a time what PostgreSQL does: nested
 * runs join the outermost, which commits when its work returns ok and otherwise, on an Err or a throw, puts every store
 * back as it was. `events` records `begin`, then `commit` or `rollback`. Its transaction is one flag of the instance,
 * not of the async context as in `DrizzleTransactionManager`, so it is not safe for concurrent runs in one test.
 */
export class RollingBackTm implements TransactionManager {
  private open = false;

  /** `snapshot` copies the stores and returns the function that restores that copy. */
  constructor(
    private readonly snapshot: () => () => void,
    readonly events: string[] = [],
  ) {}

  async run<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.open) return work();
    const restore = this.snapshot();
    this.open = true;
    this.events.push("begin");
    try {
      const result = await work();
      this.events.push(result.ok ? "commit" : "rollback");
      if (!result.ok) restore();
      return result;
    } catch (error) {
      this.events.push("rollback");
      restore();
      throw error;
    } finally {
      this.open = false;
    }
  }
}

/** What budgeting answers for a due date, as M3-B binds it: whether its period is CLOSED, and its default split. */
export interface BudgetingStandIn {
  readonly closed?: (date: LocalDate) => boolean;
  readonly weights?: (
    date: LocalDate,
  ) => readonly { readonly memberId: string; readonly weight: bigint }[] | null;
}

/**
 * The recurrence world with the ledger's own record use cases as recorders (ruling P21) and a transaction manager that
 * rolls back (`tm`, whose `events` the tests read); `closed` and `weights` stand in for budgeting's ClosedPeriodGuard
 * and DefaultSplitSource, per date.
 */
export const materializerWorld = (budgeting: BudgetingStandIn = {}) => {
  const w = recurrenceWorld();
  const tm = new RollingBackTm(() => {
    const kept = {
      transactions: [...w.store.rows],
      recurrences: [...w.recurrences.rows],
      occurrences: [...w.recurrences.occurrenceRows],
    };
    return () => {
      w.store.rows = kept.transactions;
      w.recurrences.rows = kept.recurrences;
      w.recurrences.occurrenceRows = kept.occurrences;
    };
  });
  const ledger: RecurrenceDeps = {
    ...w.deps,
    tm,
    closedPeriods: { isClosed: async (_spaceId, date) => budgeting.closed?.(date) ?? false },
    defaultSplits: { allocationWeights: async (expense) => budgeting.weights?.(expense.date) ?? null },
  };
  const deps: MaterializeDeps = { ...ledger, recorders: occurrenceRecorders(ledger) };
  const define = async (definition: DefineRecurrenceInput): Promise<Recurrence> =>
    unwrap(await createDefineRecurrence(deps)(definition)).recurrence;
  const run = (today: string) => createMaterializeDueOccurrences(deps)({ today: today as LocalDate });
  return { ...w, deps, tm, define, run };
};
