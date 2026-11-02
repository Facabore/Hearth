import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { createGetMemberNetBalance } from "@/modules/balances/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import type { LedgerDeps } from "@/modules/ledger/application";
import { createDefineRecurrence } from "@/modules/ledger/application/define-recurrence";
import { createEndRecurrence } from "@/modules/ledger/application/manage-recurrence";
import {
  createMaterializeDueOccurrences,
  type MaterializationReport,
} from "@/modules/ledger/application/materialize-occurrences";
import type { MaterializeDeps } from "@/modules/ledger/application/materialize-recurrence";
import { occurrenceRecorders } from "@/modules/ledger/application/record-occurrence";
import type {
  OccurrenceRepository,
  RecurrenceRepository,
} from "@/modules/ledger/application/recurrence-ports";
import { statusOf } from "@/modules/ledger/domain/recurrence";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleRecurrenceRepository } from "@/modules/ledger/infrastructure/drizzle-recurrence-repository";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import {
  createLeaveSpace,
  createSpaceAccess,
  type LifecycleDeps,
  type SpaceId,
  type SpaceMember,
} from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { codeOf, fixedTimeZones, money, unwrap } from "../../tests/support/fakes";
import {
  accountFixture,
  personalSpaceFixture,
  sharedLedgerFixture,
  type SharedLedgerFixture,
  type SpaceFixture,
} from "../../tests/support/fixtures";
import { bothSettled, heldBy, holder } from "../../tests/support/locks";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const accounts = new DrizzleAccountRepository(tm);
const categories = new DrizzleCategoryRepository(tm);
const recurrenceRepo = new DrizzleRecurrenceRepository(tm);
const ledgerQueries = new DrizzleLedgerQueries(tm);
const clock = new FixedClock(new Date("2026-10-28T17:00:00Z"));
const FIRST_DATE = "2026-11-01" as LocalDate;

afterAll(() => pool.end());

type Holder = ReturnType<typeof holder>;

/** Household with Ana (OWNER, bank account), the guest Pedro and Bruno, a MEMBER with his own bank account. */
interface World extends SharedLedgerFixture {
  readonly bruno: SpaceFixture;
  readonly brunoBank: string;
}

const world = async (): Promise<World> => {
  const base = await sharedLedgerFixture(db, pool);
  const bruno = await personalSpaceFixture(db, pool, "Bruno");
  const member: SpaceMember = {
    id: randomUUID() as SpaceMember["id"],
    kind: "USER",
    userId: bruno.userId,
    displayName: "Bruno",
    role: "MEMBER",
    contactEmail: null,
    joinedAt: new Date(),
  };
  expect(await spaces.addMember(base.household.spaceId as SpaceId, member)).toBe("added");
  return {
    ...base,
    bruno: { userId: bruno.userId, spaceId: base.household.spaceId, memberId: member.id },
    brunoBank: await accountFixture(db, bruno, "Nequi"),
  };
};

/** The ledger's deps over PostgreSQL as the composition root builds them; `members` is the port a test may hold. */
const ledgerDeps = (members: LedgerDeps["members"] = spaces): LedgerDeps => ({
  access: createSpaceAccess(spaces),
  members,
  spaceLocks: spaces,
  transactions: new DrizzleTransactionRepository(tm),
  query: ledgerQueries,
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
  clock,
  timeZone: "America/Bogota",
  userTimeZones: fixedTimeZones(),
  tm,
});

/**
 * The scheduler's deps over PostgreSQL. It sees only `recurrenceId`, since other files share the database; the
 * occurrence recorders run over `recording`, the ledger deps a test may hold.
 */
const schedulerDeps = (recurrenceId: string, recording: LedgerDeps = ledgerDeps()): MaterializeDeps => {
  const recurrences: RecurrenceRepository = {
    add: (r) => recurrenceRepo.add(r),
    find: (spaceId, id) => recurrenceRepo.find(spaceId, id),
    list: (spaceId) => recurrenceRepo.list(spaceId),
    lockForWrite: (spaceId, id) => recurrenceRepo.lockForWrite(spaceId, id),
    save: (r) => recurrenceRepo.save(r),
    listActive: async (today) =>
      (await recurrenceRepo.listActive(today)).filter((a) => a.id === recurrenceId),
  };
  const occurrences: OccurrenceRepository = {
    addOccurrence: (o) => recurrenceRepo.addOccurrence(o),
    saveOccurrence: (o) => recurrenceRepo.saveOccurrence(o),
    findOccurrence: (spaceId, id, options) => recurrenceRepo.findOccurrence(spaceId, id, options),
    pendingOccurrences: (spaceId) => recurrenceRepo.pendingOccurrences(spaceId),
    latestOccurrences: (spaceId, ids) => recurrenceRepo.latestOccurrences(spaceId, ids),
  };
  return { ...ledgerDeps(), recurrences, occurrences, recorders: occurrenceRecorders(recording) };
};

/** The real spaces repository, but whoever reads the current members stops in `h.hold()` once it has read them. */
const holdingMembers = (h: Holder): LedgerDeps["members"] => ({
  listCurrent: async (spaceId, options) => {
    const members = await spaces.listCurrent(spaceId, options);
    await h.hold();
    return members;
  },
});

/** Bruno's leave; with `h`, it stops in `h.hold()` once it has read his balance, as the check decides on it. */
const leaveOf = (w: World, h?: Holder) => {
  const netBalance = createGetMemberNetBalance(ledgerQueries);
  const deps: LifecycleDeps = {
    access: createSpaceAccess(spaces),
    members: spaces,
    spaceLocks: spaces,
    netBalance: async (spaceId, memberId) => {
      const net = await netBalance(spaceId, memberId);
      await h?.hold();
      return net;
    },
    clock,
    tm,
  };
  return createLeaveSpace(deps)({ spaceId: w.household.spaceId, userId: w.bruno.userId });
};

/** The recurrences the running test defined, ended (logically, D8) after it unless they paused or ended already. */
const defined: { readonly spaceId: string; readonly userId: string; readonly id: string }[] = [];

afterEach(async () => {
  for (const { spaceId, userId, id } of defined.splice(0)) {
    const stored = await recurrenceRepo.find(spaceId, id);
    if (stored === null || statusOf(stored) !== "ACTIVE") continue;
    unwrap(await createEndRecurrence(schedulerDeps(id))({ spaceId, userId, recurrenceId: id }));
  }
});

/**
 * Bruno's AUTO "Internet": 60,000 COP from his own Nequi on day 1 from 2026-11-01, split EQUAL with Ana, so each
 * occurrence leaves Ana owing him 30,000. He is its payer and its creator (ruling P21).
 */
const brunosInternet = async (w: World) => {
  const { recurrence } = unwrap(
    await createDefineRecurrence(schedulerDeps(""))({
      spaceId: w.household.spaceId,
      userId: w.bruno.userId,
      description: "Internet",
      amount: money(6_000_000n),
      template: {
        type: "EXPENSE",
        categoryId: w.groceries,
        payer: { memberId: w.bruno.memberId, accountId: w.brunoBank },
        split: {
          method: "EQUAL",
          participants: [{ memberId: w.household.memberId }, { memberId: w.bruno.memberId }],
        },
      },
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: FIRST_DATE,
      endDate: null,
    }),
  );
  defined.push({ spaceId: recurrence.spaceId, userId: recurrence.createdBy, id: recurrence.id });
  return recurrence;
};

const run = (deps: MaterializeDeps): Promise<MaterializationReport> =>
  createMaterializeDueOccurrences(deps)({ today: FIRST_DATE });

/** What a report says of each occurrence, and why the run paused the recurrence, if it did. */
const summary = (report: MaterializationReport) => ({
  occurrences: report.occurrences.map(
    (o) => `${o.date} ${o.status}${o.reason === null ? "" : ` ${o.reason}`}`,
  ),
  paused: report.paused.map((p) => p.reason),
  failures: report.failures.map((f) => f.error),
});

const transactionsOf = async (spaceId: string): Promise<number> =>
  (await pool.query("SELECT count(*)::int AS n FROM transactions WHERE space_id = $1", [spaceId])).rows[0].n;

/** Whether a member who is no longer current still has money owed to or by them: the damage the race does. */
const formerMembersWithBalance = async (spaceId: string): Promise<string[]> => {
  const { rows } = await pool.query(
    "SELECT id FROM space_members WHERE space_id = $1 AND left_at IS NOT NULL",
    [spaceId],
  );
  const netBalance = createGetMemberNetBalance(ledgerQueries);
  const owing: string[] = [];
  for (const row of rows) if ((await netBalance(spaceId, row.id)) !== 0n) owing.push(row.id);
  return owing;
};

/**
 * Issue #149 (ruling P283): an AUTO occurrence against the leave of its payer. Each race stops one side inside its
 * transaction, holding its locks and uncommitted rows, until the other queues behind a lock it holds (`holder`).
 */
describe("an AUTO recurrence's run against its payer's leave (#89, #149)", () => {
  it("skips the date as PayerLeft and pauses, recording nothing, when the leave is in progress", async () => {
    const w = await world();
    const internet = await brunosInternet(w);
    const h = holder(tm, pool);
    const leaving = leaveOf(w, h);
    await heldBy(h, leaving);
    const running = run(schedulerDeps(internet.id)).finally(h.release);
    const [left, report] = await bothSettled(leaving, running);
    expect(codeOf(left)).toBe("ok");
    // Ruling P283: the run waits for the leave before it reads who is current, so it pauses for the reason the
    // recurrence can no longer record (PayerLeft, P26), never for the ledger's refusal of a creator who is gone.
    expect(summary(report)).toEqual({
      occurrences: ["2026-11-01 SKIPPED PayerLeft"],
      paused: ["PayerLeft"],
      failures: [],
    });
    expect(await transactionsOf(w.household.spaceId)).toBe(0);
    expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
  });

  it("makes the leave answer OutstandingBalance once the occurrence it was recording committed", async () => {
    const w = await world();
    const internet = await brunosInternet(w);
    const h = holder(tm, pool);
    const running = run(schedulerDeps(internet.id, ledgerDeps(holdingMembers(h))));
    await heldBy(h, running);
    const leaving = leaveOf(w).finally(h.release);
    const [report, left] = await bothSettled(running, leaving);
    expect(summary(report)).toEqual({ occurrences: ["2026-11-01 RECORDED"], paused: [], failures: [] });
    expect(codeOf(left)).toBe("OutstandingBalance");
    expect(await transactionsOf(w.household.spaceId)).toBe(1);
    expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
  });
});
