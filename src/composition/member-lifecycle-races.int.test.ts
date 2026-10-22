import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { createGetMemberNetBalance, createGetMemberNetBalances } from "@/modules/balances/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import {
  createEditTransaction,
  createDeleteTransaction,
  createRecordExpense,
  createRecordFundContribution,
  createRecordSettlement,
  type LedgerDeps,
} from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import {
  createArchiveSpace,
  createLeaveSpace,
  createRemoveGuestMember,
  createSpaceAccess,
  type LifecycleDeps,
  type SpaceId,
  type SpaceMember,
} from "@/modules/spaces/application";
import { DrizzleInvitationRepository } from "@/modules/spaces/infrastructure/drizzle-invitation-repository";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, type Result } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { fixedTimeZones, money, unwrap } from "../../tests/support/fakes";
import {
  accountFixture,
  personalSpaceFixture,
  sharedLedgerFixture,
  type SharedLedgerFixture,
  type SpaceFixture,
} from "../../tests/support/fixtures";
import { heldBy, holder, outcomesOf } from "../../tests/support/locks";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const accounts = new DrizzleAccountRepository(tm);
const categories = new DrizzleCategoryRepository(tm);
const ledgerQueries = new DrizzleLedgerQueries(tm);
const clock = new FixedClock(new Date("2026-10-28T17:00:00Z"));

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

/** The real spaces repository, but whoever reads the current members stops in `h.hold()` once it has read them. */
const holdingMembers = (h: Holder): LedgerDeps["members"] => ({
  listCurrent: async (spaceId, options) => {
    const members = await spaces.listCurrent(spaceId, options);
    await h.hold();
    return members;
  },
});

/** The lifecycle deps; the balance read stops in `h.hold()` once it has read the nets, as the check decides on them. */
const lifecycleDeps = (h?: Holder) => {
  const netBalance = createGetMemberNetBalance(ledgerQueries);
  const netBalances = createGetMemberNetBalances(ledgerQueries);
  const lifecycle: LifecycleDeps = {
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
  const archive = {
    ...lifecycle,
    spaces,
    netBalances: async (spaceId: string, memberIds: readonly string[]) => {
      const nets = await netBalances(spaceId, memberIds);
      await h?.hold();
      return nets;
    },
  };
  return {
    leave: createLeaveSpace(lifecycle),
    remove: createRemoveGuestMember({ ...lifecycle, invitations: new DrizzleInvitationRepository(tm) }),
    archive: createArchiveSpace(archive),
  };
};

/** Ana pays 30,000 for herself and Bruno (or Pedro): they owe 15,000 each. */
const sharedExpense = (w: World, withMember: string) =>
  createRecordExpense(ledgerDeps())({
    spaceId: w.household.spaceId,
    userId: w.household.userId,
    description: "Groceries",
    amount: money(3_000_000n),
    categoryId: w.groceries,
    accountId: w.bank,
    split: { method: "EQUAL", participants: [{ memberId: w.household.memberId }, { memberId: withMember }] },
  });

const settleBruno = (w: World, deps: LedgerDeps = ledgerDeps(), minor = 1_500_000n) =>
  createRecordSettlement(deps)({
    spaceId: w.household.spaceId,
    userId: w.household.userId,
    amount: money(minor),
    payerMemberId: w.bruno.memberId,
    receivingMemberId: w.household.memberId,
  });

/**
 * Ana pays 30,000 for Bruno alone (the sole share follows a new amount, so the expense can be edited) and Bruno pays
 * it back: his balance is zero, and both rows name him.
 */
const settledBruno = async (w: World) => {
  const expense = unwrap(
    await createRecordExpense(ledgerDeps())({
      spaceId: w.household.spaceId,
      userId: w.household.userId,
      description: "Groceries for Bruno",
      amount: money(3_000_000n),
      categoryId: w.groceries,
      accountId: w.bank,
      split: { method: "EQUAL", participants: [{ memberId: w.bruno.memberId }] },
    }),
  ).expense;
  const settlement = unwrap(await settleBruno(w, ledgerDeps(), 3_000_000n));
  return { expense, settlement };
};

/** Every writer that names Bruno, each over the given ledger deps; the money it moves changes his balance or his role. */
const writers = {
  "an expense": (w: World, deps: LedgerDeps) =>
    createRecordExpense(deps)({
      spaceId: w.household.spaceId,
      userId: w.household.userId,
      amount: money(3_000_000n),
      categoryId: w.groceries,
      accountId: w.bank,
      split: {
        method: "EQUAL",
        participants: [{ memberId: w.household.memberId }, { memberId: w.bruno.memberId }],
      },
    }),
  "a settlement": (w: World, deps: LedgerDeps) => settleBruno(w, deps),
  "a fund contribution": (w: World, deps: LedgerDeps) =>
    createRecordFundContribution(deps)({
      spaceId: w.household.spaceId,
      userId: w.bruno.userId,
      amount: money(500_000n),
      fundAccountId: w.fund,
      memberId: w.bruno.memberId,
      sourceAccountId: w.brunoBank,
    }),
} as const;

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

const archivedAt = async (spaceId: string) =>
  (await pool.query("SELECT archived_at FROM spaces WHERE id = $1", [spaceId])).rows[0]
    .archived_at as Date | null;

describe("leaving, removing and archiving against concurrent money writes (#89)", () => {
  describe("a leave in progress (the leaver's balance already read as zero)", () => {
    // The contribution is the leaver's own (D9: only the owner of the source account records it), so it is refused
    // for lack of a membership; the others are Ana's and name the leaver.
    const refusals = {
      "an expense": "NotASpaceMember",
      "a settlement": "NotASpaceMember",
      "a fund contribution": "SpaceNotFound",
    };
    for (const [name, write] of Object.entries(writers)) {
      it(`refuses ${name} that names the leaver, which waits for the leave to commit`, async () => {
        const w = await world();
        const h = holder(tm, pool);
        const leaving = lifecycleDeps(h).leave({ spaceId: w.household.spaceId, userId: w.bruno.userId });
        await heldBy(h, leaving);
        const writing = write(w, ledgerDeps()).finally(h.release);
        expect(await outcomesOf(leaving, writing)).toEqual([refusals[name as keyof typeof refusals], "ok"]);
        expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
      });
    }

    it("refuses the deletion of a settlement that names the leaver", async () => {
      const w = await world();
      const { settlement } = await settledBruno(w);
      const h = holder(tm, pool);
      const leaving = lifecycleDeps(h).leave({ spaceId: w.household.spaceId, userId: w.bruno.userId });
      await heldBy(h, leaving);
      const deleting = createDeleteTransaction(ledgerDeps())({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
        transactionId: settlement.id,
      }).finally(h.release);
      expect(await outcomesOf(leaving, deleting)).toEqual(["NotASpaceMember", "ok"]);
      expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
    });

    it("refuses an amount edit of an expense that names the leaver", async () => {
      const w = await world();
      const { expense } = await settledBruno(w);
      const h = holder(tm, pool);
      const leaving = lifecycleDeps(h).leave({ spaceId: w.household.spaceId, userId: w.bruno.userId });
      await heldBy(h, leaving);
      const editing = createEditTransaction(ledgerDeps())({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
        transactionId: expense.id,
        expectedVersion: null,
        changes: { amount: money(4_000_000n) },
      }).finally(h.release);
      expect(await outcomesOf(leaving, editing)).toEqual(["NotASpaceMember", "ok"]);
      expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
    });
  });

  describe("a money write in progress (it already read the current members)", () => {
    for (const [name, write] of [
      ["an expense", writers["an expense"]],
      ["a settlement", writers["a settlement"]],
    ] as const) {
      it(`makes the leave answer OutstandingBalance once ${name} that names the leaver committed`, async () => {
        const w = await world();
        const h = holder(tm, pool);
        const writing = write(w, ledgerDeps(holdingMembers(h)));
        await heldBy(h, writing);
        const leaving = lifecycleDeps()
          .leave({ spaceId: w.household.spaceId, userId: w.bruno.userId })
          .finally(h.release);
        expect(await outcomesOf(writing, leaving)).toEqual(["OutstandingBalance", "ok"]);
        expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
      });
    }

    it("makes the leave answer OutstandingBalance once the deletion of a settlement that names the leaver committed", async () => {
      const w = await world();
      const { settlement } = await settledBruno(w);
      const h = holder(tm, pool);
      const deleting = createDeleteTransaction(ledgerDeps(holdingMembers(h)))({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
        transactionId: settlement.id,
      });
      await heldBy(h, deleting);
      const leaving = lifecycleDeps()
        .leave({ spaceId: w.household.spaceId, userId: w.bruno.userId })
        .finally(h.release);
      expect(await outcomesOf(deleting, leaving)).toEqual(["OutstandingBalance", "ok"]);
      expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
    });

    it("makes the leave answer OutstandingBalance once an amount edit that names the leaver committed", async () => {
      const w = await world();
      const { expense } = await settledBruno(w);
      const h = holder(tm, pool);
      const editing = createEditTransaction(ledgerDeps(holdingMembers(h)))({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
        transactionId: expense.id,
        expectedVersion: null,
        changes: { amount: money(4_000_000n) },
      });
      await heldBy(h, editing);
      const leaving = lifecycleDeps()
        .leave({ spaceId: w.household.spaceId, userId: w.bruno.userId })
        .finally(h.release);
      expect(await outcomesOf(editing, leaving)).toEqual(["OutstandingBalance", "ok"]);
      expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
    });
  });

  describe("removing a guest", () => {
    it("refuses an expense that names the guest while the removal is in progress", async () => {
      const w = await world();
      const h = holder(tm, pool);
      const removing = lifecycleDeps(h).remove({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
        memberId: w.pedro,
      });
      await heldBy(h, removing);
      const writing = sharedExpense(w, w.pedro).finally(h.release);
      expect(await outcomesOf(removing, writing)).toEqual(["NotASpaceMember", "ok"]);
      expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
    });

    it("answers OutstandingBalance to the removal once an expense that names the guest committed", async () => {
      const w = await world();
      const h = holder(tm, pool);
      const writing = createRecordExpense(ledgerDeps(holdingMembers(h)))({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
        amount: money(3_000_000n),
        categoryId: w.groceries,
        accountId: w.bank,
        split: { method: "EQUAL", participants: [{ memberId: w.household.memberId }, { memberId: w.pedro }] },
      });
      await heldBy(h, writing);
      const removing = lifecycleDeps()
        .remove({ spaceId: w.household.spaceId, userId: w.household.userId, memberId: w.pedro })
        .finally(h.release);
      expect(await outcomesOf(writing, removing)).toEqual(["OutstandingBalance", "ok"]);
      expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
    });
  });

  describe("archiving a space", () => {
    it("refuses an expense recorded while the archive is in progress", async () => {
      const w = await world();
      const h = holder(tm, pool);
      const archiving = lifecycleDeps(h).archive({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
      });
      await heldBy(h, archiving);
      const writing = sharedExpense(w, w.bruno.memberId).finally(h.release);
      expect(await outcomesOf(archiving, writing)).toEqual(["SpaceArchived", "ok"]);
      expect(await archivedAt(w.household.spaceId)).not.toBeNull();
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM transactions WHERE space_id = $1", [
        w.household.spaceId,
      ]);
      expect(rows[0].n).toBe(0);
    });

    it("answers OutstandingBalance to the archive once an expense committed", async () => {
      const w = await world();
      const h = holder(tm, pool);
      const writing = writers["an expense"](w, ledgerDeps(holdingMembers(h)));
      await heldBy(h, writing);
      const archiving = lifecycleDeps()
        .archive({ spaceId: w.household.spaceId, userId: w.household.userId })
        .finally(h.release);
      expect(await outcomesOf(writing, archiving)).toEqual(["OutstandingBalance", "ok"]);
      expect(await archivedAt(w.household.spaceId)).toBeNull();
    });
  });

  describe("the lock order", () => {
    it("never deadlocks when leaves, removals, archives, role changes and money writes of one space run together", async () => {
      const w = await world();
      const lifecycle = lifecycleDeps();
      const attempts: Promise<Result<unknown>>[] = [];
      for (let round = 0; round < 4; round += 1) {
        attempts.push(
          lifecycle.leave({ spaceId: w.household.spaceId, userId: w.bruno.userId }),
          lifecycle.remove({ spaceId: w.household.spaceId, userId: w.household.userId, memberId: w.pedro }),
          lifecycle.archive({ spaceId: w.household.spaceId, userId: w.household.userId }),
          writers["an expense"](w, ledgerDeps()),
          writers["a settlement"](w, ledgerDeps()),
          writers["a fund contribution"](w, ledgerDeps()),
        );
      }
      const outcomes = await outcomesOf(...attempts);
      expect(outcomes.filter((outcome) => outcome.startsWith("rejected"))).toEqual([]);
      expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
    });
  });
});
