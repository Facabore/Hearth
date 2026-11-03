import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { createGetMemberNetBalance } from "@/modules/balances/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import {
  createConvertTransaction,
  createEditTransaction,
  createRecordExpense,
  createRecordFundContribution,
  createRecordIncome,
  createRecordSettlement,
  createRecordTransfer,
  type LedgerDeps,
} from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
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
import { FixedClock } from "@/shared/kernel";
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

/** Household with Ana (OWNER, bank account and the fund) and Bruno, a MEMBER with his own bank account. */
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

/** The ledger's deps over PostgreSQL as the composition root builds them; a test may hold `members` or `transactions`. */
const ledgerDeps = (
  hooks: { members?: LedgerDeps["members"]; transactions?: LedgerDeps["transactions"] } = {},
): LedgerDeps => ({
  access: createSpaceAccess(spaces),
  members: hooks.members ?? spaces,
  spaceLocks: spaces,
  transactions: hooks.transactions ?? new DrizzleTransactionRepository(tm),
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

const converterOf = (deps: LedgerDeps) =>
  createConvertTransaction(deps, {
    recordExpense: createRecordExpense(deps),
    recordIncome: createRecordIncome(deps),
    recordTransfer: createRecordTransfer(deps),
    recordFundContribution: createRecordFundContribution(deps),
  });

/** The real spaces repository, but whoever reads the current members stops in `h.hold()` once it has read them. */
const holdingMembers = (h: Holder): LedgerDeps["members"] => ({
  listCurrent: async (spaceId, options) => {
    const members = await spaces.listCurrent(spaceId, options);
    await h.hold();
    return members;
  },
});

/** The real repository, but the conversion's soft delete of the original stops in `h.hold()` before it is written. */
class HoldingSave extends DrizzleTransactionRepository {
  constructor(
    private readonly h: Holder,
    private readonly originalId: string,
  ) {
    super(tm);
  }

  override async save(...args: Parameters<DrizzleTransactionRepository["save"]>): Promise<boolean> {
    if (args[0].id === this.originalId) await this.h.hold();
    return super.save(...args);
  }
}

/** The leave as the composition root builds it; the balance read stops in `h.hold()` once it has read the net. */
const leaveOf = (h?: Holder) => {
  const netBalance = createGetMemberNetBalance(ledgerQueries);
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
  return createLeaveSpace(lifecycle);
};

/**
 * Ana pays 30,000 for Bruno alone and Bruno pays it back: his balance is zero, and removing the expense (as its
 * conversion does) would leave Ana owing him the 30,000 he paid.
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
  unwrap(
    await createRecordSettlement(ledgerDeps())({
      spaceId: w.household.spaceId,
      userId: w.household.userId,
      amount: money(3_000_000n),
      payerMemberId: w.bruno.memberId,
      receivingMemberId: w.household.memberId,
    }),
  );
  return expense;
};

/** Ana's expense becomes her own contribution of the same 30,000 to the fund (issue #195). */
const toContribution = (w: World, deps: LedgerDeps, transactionId: string) =>
  converterOf(deps)({
    spaceId: w.household.spaceId,
    userId: w.household.userId,
    transactionId,
    expectedVersion: null,
    to: {
      type: "FUND_CONTRIBUTION",
      amount: money(3_000_000n),
      fundAccountId: w.fund,
      sourceAccountId: w.bank,
    },
  });

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

/** The space's live movements by type, and how many rows it has in all (deleted ones are kept, D8). */
const movementsOf = async (spaceId: string) => {
  const { rows } = await pool.query(
    "SELECT type, deleted_at IS NULL AS live FROM transactions WHERE space_id = $1 ORDER BY created_at, id",
    [spaceId],
  );
  return { live: rows.filter((r) => r.live).map((r) => r.type as string), all: rows.length };
};

/** One movement's stored amount, version and whether it is live. */
const rowOf = async (id: string) =>
  (
    await pool.query(
      "SELECT amount::text AS amount, version, deleted_at IS NULL AS live FROM transactions WHERE id = $1",
      [id],
    )
  ).rows[0] as { amount: string; version: number; live: boolean };

/** The actions of a movement's audit, in order. */
const auditActionsOf = async (id: string) =>
  (
    await pool.query("SELECT action FROM transaction_audit WHERE transaction_id = $1 ORDER BY at, id", [id])
  ).rows.map((r) => r.action as string);

describe("converting a movement against concurrent writes (#198, #89)", () => {
  it("refuses a conversion that would move a leaver's balance, which waits for the leave to commit", async () => {
    const w = await world();
    const expense = await settledBruno(w);
    const h = holder(tm, pool);
    const leaving = leaveOf(h)({ spaceId: w.household.spaceId, userId: w.bruno.userId });
    await heldBy(h, leaving);
    const converting = toContribution(w, ledgerDeps(), expense.id).finally(h.release);
    expect(await outcomesOf(leaving, converting)).toEqual(["NotASpaceMember", "ok"]);
    expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
    expect((await movementsOf(w.household.spaceId)).live).toEqual(["EXPENSE", "SETTLEMENT"]);
  });

  it("makes the leave answer OutstandingBalance once a conversion that moved the leaver's balance committed", async () => {
    const w = await world();
    const expense = await settledBruno(w);
    const h = holder(tm, pool);
    const converting = toContribution(w, ledgerDeps({ members: holdingMembers(h) }), expense.id);
    await heldBy(h, converting);
    const leaving = leaveOf()({ spaceId: w.household.spaceId, userId: w.bruno.userId }).finally(h.release);
    expect(await outcomesOf(converting, leaving)).toEqual(["OutstandingBalance", "ok"]);
    expect(await formerMembersWithBalance(w.household.spaceId)).toEqual([]);
  });

  // Money writes share the space lock (FOR SHARE), so they run side by side; the original's version decides.
  describe("a money write on the same original", () => {
    it("rolls the conversion's new movement back when an edit of the original commits first", async () => {
      const w = await world();
      const expense = await settledBruno(w);
      const before = await movementsOf(w.household.spaceId);
      const h = holder(tm, pool);
      const converting = toContribution(
        w,
        ledgerDeps({ transactions: new HoldingSave(h, expense.id) }),
        expense.id,
      );
      // The contribution is recorded; the soft delete of the original is not written yet.
      await heldBy(h, converting);
      const editing = createEditTransaction(ledgerDeps())({
        spaceId: w.household.spaceId,
        userId: w.household.userId,
        transactionId: expense.id,
        expectedVersion: null,
        changes: { amount: money(4_000_000n) },
      }).finally(h.release);
      expect(await outcomesOf(converting, editing)).toEqual(["PreconditionFailed", "ok"]);
      // No contribution survives: the money is counted once, as the edited expense.
      expect(await movementsOf(w.household.spaceId)).toEqual(before);
      expect(await rowOf(expense.id)).toEqual({ amount: "4000000", version: 2, live: true });
      expect(await auditActionsOf(expense.id)).toEqual(["UPDATED"]);
    });

    it("lets only one of two conversions of the same original commit", async () => {
      const w = await world();
      const expense = await settledBruno(w);
      const h = holder(tm, pool);
      const first = toContribution(
        w,
        ledgerDeps({ transactions: new HoldingSave(h, expense.id) }),
        expense.id,
      );
      await heldBy(h, first);
      const second = toContribution(w, ledgerDeps(), expense.id).finally(h.release);
      expect(await outcomesOf(first, second)).toEqual(["PreconditionFailed", "ok"]);
      expect(await movementsOf(w.household.spaceId)).toEqual({ live: ["SETTLEMENT", "TRANSFER"], all: 3 });
      expect(await auditActionsOf(expense.id)).toEqual(["DELETED"]);
    });
  });
});
