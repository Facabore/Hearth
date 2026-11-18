import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createGetMemberNetBalance, createGetMemberNetBalances } from "@/modules/balances/application";
import { recordExpense, recordSettlement, type TransactionId } from "@/modules/ledger/domain/transaction";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import {
  personalSpaceFixture,
  sharedLedgerFixture,
  type SharedLedgerFixture,
} from "../../../../tests/support/fixtures";
import { createArchiveSpace } from "../application/archive-space";
import { createLeaveSpace } from "../application/leave-space";
import type { LifecycleDeps } from "../application/lifecycle-deps";
import { createRemoveGuestMember } from "../application/remove-guest-member";
import { createSpaceAccess } from "../application/space-access";
import type { SpaceId, SpaceMember } from "../domain/space";
import { DrizzleInvitationRepository } from "./drizzle-invitation-repository";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const transactions = new DrizzleTransactionRepository(tm);
const ledgerQueries = new DrizzleLedgerQueries(tm);

afterAll(() => pool.end());

/** The lifecycle use cases over PostgreSQL, wired to the balances queries as the composition root wires them. */
const lifecycle: LifecycleDeps = {
  access: createSpaceAccess(spaces),
  members: spaces,
  spaceLocks: spaces,
  netBalance: createGetMemberNetBalance(ledgerQueries),
  clock: new FixedClock(new Date("2026-10-28T17:00:00Z")),
  tm,
};
const leave = createLeaveSpace(lifecycle);
const removeGuest = createRemoveGuestMember({
  ...lifecycle,
  invitations: new DrizzleInvitationRepository(tm),
});
const archive = createArchiveSpace({
  ...lifecycle,
  spaces,
  netBalances: createGetMemberNetBalances(ledgerQueries),
});

let minute = 0;
const base = (w: SharedLedgerFixture, amount: bigint, currency: string) => ({
  id: randomUUID() as TransactionId,
  spaceId: w.household.spaceId,
  description: `P342 ${currency}`,
  date: "2026-10-05" as LocalDate,
  amount,
  currency,
  createdBy: w.household.userId,
  now: new Date(Date.UTC(2026, 9, 5, 12, (minute += 1))),
});
/** `payer` pays `amount` of `currency` for `debtor` alone. */
const paidFor = (w: SharedLedgerFixture, amount: bigint, currency: string, payer: string, debtor: string) =>
  transactions.add(
    unwrap(
      recordExpense({
        ...base(w, amount, currency),
        categoryId: w.groceries,
        payments: [{ memberId: payer, accountId: null, amount }],
        shares: [{ memberId: debtor, amount, splitMethod: "EXACT" }],
      }),
    ),
  );
const settled = (w: SharedLedgerFixture, amount: bigint, currency: string, payer: string, receiver: string) =>
  transactions.add(
    unwrap(
      recordSettlement({
        ...base(w, amount, currency),
        payerMemberId: payer,
        receivingMemberId: receiver,
        sourceAccountId: null,
        destinationAccountId: null,
      }),
    ),
  );
const outstanding = (amount: string, currency: string) => ({
  ok: false,
  error: { code: "OutstandingBalance", details: { outstanding: { amount, currency } } },
});

/** Household (COP) with Ana, the guest Pedro and Bruno, a MEMBER; even in COP after a payment back. */
const world = async () => {
  const w = await sharedLedgerFixture(db, pool);
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
  expect(await spaces.addMember(w.household.spaceId as SpaceId, member)).toBe("added");
  // 100.000 COP each way between Ana and Bruno: every COP net is 0.
  await paidFor(w, 10_000_000n, "COP", w.household.memberId, member.id);
  await paidFor(w, 10_000_000n, "COP", member.id, w.household.memberId);
  return { ...w, bruno: { userId: bruno.userId, memberId: member.id } };
};

describe("leaving, removing a guest and archiving with debts in several currencies (P342, S4)", () => {
  it("refuses Bruno's leave with 0 COP while he owes Ana 30 USD, and lets him leave once he paid it in USD", async () => {
    const w = await world();
    await paidFor(w, 3_000n, "USD", w.household.memberId, w.bruno.memberId);
    const asBruno = { spaceId: w.household.spaceId, userId: w.bruno.userId };
    expect(await leave(asBruno)).toEqual(outstanding("3000", "USD"));
    await settled(w, 3_000n, "USD", w.bruno.memberId, w.household.memberId);
    expect(await leave(asBruno)).toEqual({ ok: true, value: undefined });
  });

  it("refuses removing the guest Pedro while Ana owes him 60 EUR, though nothing is owed in COP", async () => {
    const w = await world();
    await paidFor(w, 6_000n, "EUR", w.pedro, w.household.memberId);
    const asAna = { spaceId: w.household.spaceId, userId: w.household.userId };
    expect(await removeGuest({ ...asAna, memberId: w.pedro })).toEqual(outstanding("6000", "EUR"));
    await settled(w, 6_000n, "EUR", w.household.memberId, w.pedro);
    expect(await removeGuest({ ...asAna, memberId: w.pedro })).toEqual({ ok: true, value: undefined });
  });

  it("refuses archiving while any currency is owed, naming the space currency first", async () => {
    const w = await world();
    const asAna = { spaceId: w.household.spaceId, userId: w.household.userId };
    await paidFor(w, 3_000n, "USD", w.household.memberId, w.bruno.memberId);
    expect(await archive(asAna)).toEqual(outstanding("3000", "USD"));
    await paidFor(w, 5_000_000n, "COP", w.bruno.memberId, w.pedro);
    expect(await archive(asAna)).toEqual(outstanding("5000000", "COP"));
    await settled(w, 5_000_000n, "COP", w.pedro, w.bruno.memberId);
    await settled(w, 3_000n, "USD", w.bruno.memberId, w.household.memberId);
    expect(await archive(asAna)).toEqual({ ok: true, value: undefined });
  });
});
