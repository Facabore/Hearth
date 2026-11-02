import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { createGetMemberNetBalance, createGetMemberNetBalances } from "@/modules/balances/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { createRecordExpense, type LedgerDeps } from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import {
  createAcceptInvitation,
  createArchiveSpace,
  createCreateInvitation,
  createLeaveSpace,
  createSpaceAccess,
  type InvitationsDeps,
  type LifecycleDeps,
  type SpaceAccess,
  type SpaceId,
  type SpaceMember,
} from "@/modules/spaces/application";
import { cryptoInvitationTokens } from "@/modules/spaces/infrastructure/crypto-invitation-tokens";
import { DrizzleInvitationRepository } from "@/modules/spaces/infrastructure/drizzle-invitation-repository";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, type Result } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { fixedTimeZones, money, unwrap } from "../../tests/support/fakes";
import {
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

/** Household with Ana (OWNER) and Bruno, a MEMBER; `link` is the token of a shareable MEMBER link Ana created. */
interface World extends SharedLedgerFixture {
  readonly bruno: SpaceFixture & { readonly email: string };
  readonly link: string;
}

/** The invitation deps over PostgreSQL as the composition root builds them; `access` is the port a test may hold. */
const invitationDeps = (access: SpaceAccess = createSpaceAccess(spaces)): InvitationsDeps => ({
  access,
  members: spaces,
  spaces,
  invitations: new DrizzleInvitationRepository(tm),
  spaceLocks: spaces,
  tokens: cryptoInvitationTokens,
  emailSender: { send: async () => false },
  users: { idByEmail: async () => null },
  // The bare token, so the created invitation's `url` is what AcceptInvitation takes.
  invitationUrl: (token) => token,
  ids: new UuidV7IdGenerator(),
  clock,
  tm,
});

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
  const created = unwrap(
    await createCreateInvitation(invitationDeps())({
      spaceId: base.household.spaceId,
      userId: base.household.userId,
      role: "MEMBER",
      target: { kind: "LINK" },
    }),
  );
  return {
    ...base,
    bruno: {
      userId: bruno.userId,
      spaceId: base.household.spaceId,
      memberId: member.id,
      email: `${bruno.userId}@example.com`,
    },
    link: created.url,
  };
};

/** The ledger's deps over PostgreSQL, enough for an expense in Household. */
const ledgerDeps = (): LedgerDeps => ({
  access: createSpaceAccess(spaces),
  members: spaces,
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

/** Ana pays 30,000 for herself and Bruno: he owes 15,000. */
const sharedExpense = (w: World) =>
  createRecordExpense(ledgerDeps())({
    spaceId: w.household.spaceId,
    userId: w.household.userId,
    description: "Groceries",
    amount: money(3_000_000n),
    categoryId: w.groceries,
    accountId: w.bank,
    split: {
      method: "EQUAL",
      participants: [{ memberId: w.household.memberId }, { memberId: w.bruno.memberId }],
    },
  });

/**
 * The lifecycle deps; the balance reads stop in `h.hold()` once they read the nets, as the checks decide on them.
 * `checked` records the members whose balances the archive read.
 */
const lifecycleDeps = (h?: Holder, checked: string[] = []) => {
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
  return {
    leave: createLeaveSpace(lifecycle),
    archive: createArchiveSpace({
      ...lifecycle,
      spaces,
      netBalances: async (spaceId: string, memberIds: readonly string[]) => {
        checked.push(...memberIds);
        const nets = await netBalances(spaceId, memberIds);
        await h?.hold();
        return nets;
      },
    }),
  };
};

/** The real SpaceAccess, but the join stops in `h.hold()` once it read the space back: its last read before commit. */
const holdingAccess =
  (h: Holder): SpaceAccess =>
  async (spaceId, userId) => {
    const access = await createSpaceAccess(spaces)(spaceId, userId);
    await h.hold();
    return access;
  };

const acceptAsBruno = (w: World, deps: InvitationsDeps = invitationDeps()) =>
  createAcceptInvitation(deps)({
    token: w.link,
    userId: w.bruno.userId,
    userEmail: w.bruno.email,
    userName: "Bruno",
  });

const isCurrent = async (spaceId: string, userId: string) =>
  (
    await pool.query("SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2 AND left_at IS NULL", [
      spaceId,
      userId,
    ])
  ).rows.length > 0;

const archivedAt = async (spaceId: string) =>
  (await pool.query("SELECT archived_at FROM spaces WHERE id = $1", [spaceId])).rows[0]
    .archived_at as Date | null;

/** Bruno's row says he left, so the link brings him back (issue #90: his own row, his own member id). */
const brunoLeft = (w: World) =>
  pool.query("UPDATE space_members SET left_at = $2 WHERE id = $1", [w.bruno.memberId, clock.now()]);

describe("accepting an invitation against leaves, archives and money writes (#149)", () => {
  it("refuses to join a space whose archive is in progress, which the join waits for", async () => {
    const w = await world();
    await brunoLeft(w);
    const h = holder(tm, pool);
    const archiving = lifecycleDeps(h).archive({ spaceId: w.household.spaceId, userId: w.household.userId });
    await heldBy(h, archiving);
    const joining = acceptAsBruno(w).finally(h.release);
    expect(await outcomesOf(archiving, joining)).toEqual(["SpaceArchived", "ok"]);
    expect(await archivedAt(w.household.spaceId)).not.toBeNull();
    expect(await isCurrent(w.household.spaceId, w.bruno.userId)).toBe(false);
  });

  it("makes an archive wait for a join in progress, so its settlement check reads the member who joined", async () => {
    const w = await world();
    await brunoLeft(w);
    const h = holder(tm, pool);
    const joining = acceptAsBruno(w, invitationDeps(holdingAccess(h)));
    await heldBy(h, joining);
    const checked: string[] = [];
    const archiving = lifecycleDeps(undefined, checked)
      .archive({ spaceId: w.household.spaceId, userId: w.household.userId })
      .finally(h.release);
    expect(await outcomesOf(joining, archiving)).toEqual(["ok", "ok"]);
    // A pre-#89 member who still owed would have been refused here: the archive answers on the balances it read.
    expect(checked).toContain(w.bruno.memberId);
  });

  it("lets a member whose leave is in progress rejoin once the leave committed, instead of answering AlreadyMember", async () => {
    const w = await world();
    const h = holder(tm, pool);
    const leaving = lifecycleDeps(h).leave({ spaceId: w.household.spaceId, userId: w.bruno.userId });
    await heldBy(h, leaving);
    const joining = acceptAsBruno(w).finally(h.release);
    expect(await outcomesOf(leaving, joining)).toEqual(["ok", "ok"]);
    expect(await isCurrent(w.household.spaceId, w.bruno.userId)).toBe(true);
  });

  it("never deadlocks when joins, leaves, archives and money writes of one space run together", async () => {
    const w = await world();
    const lifecycle = lifecycleDeps();
    const attempts: Promise<Result<unknown>>[] = [];
    for (let round = 0; round < 4; round += 1) {
      attempts.push(
        acceptAsBruno(w),
        lifecycle.leave({ spaceId: w.household.spaceId, userId: w.bruno.userId }),
        lifecycle.archive({ spaceId: w.household.spaceId, userId: w.household.userId }),
        sharedExpense(w),
      );
    }
    const outcomes = await outcomesOf(...attempts);
    expect(outcomes.filter((outcome) => outcome.startsWith("rejected"))).toEqual([]);
  });
});
