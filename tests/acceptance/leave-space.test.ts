import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { PATCH as editTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balancesOf,
  cop,
  household,
  joinHousehold,
  memberIdOf,
  paysEqually,
  post,
  settles,
  type TransactionDto,
} from "../support/ledger";
import { joinAs } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const leave = (user: TestUser, spaceId: string) =>
  call(leaveSpace, "POST", `/api/v1/spaces/${spaceId}/leave`, { user, params: { spaceId } });
const leftAtOf = async (memberId: string): Promise<Date | null> =>
  (await app.pool.query("SELECT left_at FROM space_members WHERE id = $1", [memberId])).rows[0].left_at;
const transactionsOf = async (user: TestUser, spaceId: string): Promise<TransactionDto[]> => {
  const path = `/api/v1/spaces/${spaceId}/transactions?period=2026-10`;
  const response = await call(listTransactions, "GET", path, { user, params: { spaceId } });
  return ((await response.json()) as { items: TransactionDto[] }).items;
};
const memberIdsOf = async (user: TestUser, spaceId: string): Promise<string[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: { id: string }[] }).items.map((m) => m.id);
};

describe("leave a space (HU-E1-08)", () => {
  it("lets Luis leave with a zero balance: leftAt is set and his past expense still names him", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const groceries = await paysEqually(luis, 100_000, [h.ana.memberId, luis.memberId], h.groceries);
    await settles(h.ana, h.ana.memberId, luis.memberId, 50_000);
    expect((await leave(luis, h.spaceId)).status).toBe(204);
    expect(await leftAtOf(luis.memberId)).toBeInstanceOf(Date);
    expect((await transactionsOf(h.ana, h.spaceId)).find((t) => t.id === groceries.id)).toMatchObject({
      payments: [{ memberId: luis.memberId, accountId: luis.account, amount: cop(100_000) }],
      shares: [
        { memberId: h.ana.memberId, amount: cop(50_000) },
        { memberId: luis.memberId, amount: cop(50_000) },
      ],
    });
    // Former members stay in the balances while the totals mention them (M2-B), here settled at 0.
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [luis.memberId, cop(0)],
    ]);
  });

  it("drops the space from Luis's lists and lets him join again later as a new member", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    expect((await leave(luis, h.spaceId)).status).toBe(204);
    const listed = await call(listSpaces, "GET", "/api/v1/spaces", { user: luis.personal });
    const { items } = (await listed.json()) as { items: { id: string }[] };
    expect(items.map((s) => s.id)).not.toContain(h.spaceId);
    expect(await memberIdsOf(h.ana, h.spaceId)).not.toContain(luis.memberId);
    await joinAs(h.ana, h.spaceId, luis.personal, "MEMBER");
    expect(await memberIdOf(h.ana, h.spaceId, "Luis")).not.toBe(luis.memberId);
  });

  it("refuses Juan, who owes Ana 150,000 COP, and states the outstanding amount", async () => {
    const h = await household();
    await paysEqually(h.ana, 300_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const response = await leave(h.juan, h.spaceId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OutstandingBalance", outstanding: cop(150_000) });
    expect(await leftAtOf(h.juan.memberId)).toBeNull();
  });

  it("refuses Luis while the guest Pedro owes him 50,000 COP (Review Focus 1)", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const pedro = await addGuest(h, "Pedro");
    await paysEqually(luis, 100_000, [luis.memberId, pedro], h.groceries);
    const response = await leave(luis, h.spaceId);
    expect(await response.json()).toMatchObject({
      status: 409,
      code: "OutstandingBalance",
      outstanding: cop(50_000),
    });
  });

  it("keeps the only OWNER and refuses leaving a personal space", async () => {
    const h = await household();
    expect(await problemOf(await leave(h.ana, h.spaceId))).toEqual([409, "LastOwnerRequired"]);
    expect(await problemOf(await leave(h.ana.personal, h.ana.personal.spaceId))).toEqual([
      409,
      "PersonalSpaceNotShareable",
    ]);
  });

  it("lets a viewer leave and never takes the former member as participant or settlement party again", async () => {
    const h = await household();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect((await leave(sofi, h.spaceId)).status).toBe(204);
    const response = await post(recordExpense, h.ana, "expenses", {
      description: "Groceries",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(90_000) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: sofi.memberId }] },
    });
    expect(await problemOf(response)).toEqual([422, "NotASpaceMember"]);
    const settlement = await post(recordSettlement, h.ana, "settlements", {
      date: "2026-10-30",
      amount: cop(10_000),
      payerMemberId: sofi.memberId,
      receivingMemberId: h.ana.memberId,
    });
    expect(await problemOf(settlement)).toEqual([422, "NotASpaceMember"]);
  });

  it("still refuses the OWNER changing what Juan settled from his own account after he left (D9)", async () => {
    const h = await household();
    await paysEqually(h.ana, 100_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const settlement = await post(recordSettlement, h.juan, "settlements", {
      date: "2026-10-30",
      amount: cop(50_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      sourceAccountId: h.juan.account,
    });
    expect(settlement.status).toBe(201);
    const { id } = (await settlement.json()) as TransactionDto;
    expect((await leave(h.juan, h.spaceId)).status).toBe(204);
    const raised = await call(editTransaction, "PATCH", `/api/v1/spaces/${h.spaceId}/transactions/${id}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: id },
      body: { amount: cop(60_000) },
    });
    expect(await problemOf(raised)).toEqual([422, "AccountNotOwned"]);
  });

  it("answers 404 SpaceNotFound to non-members and malformed ids", async () => {
    const h = await household();
    const marta = await registerUser("Marta");
    for (const spaceId of [h.spaceId, "not-a-uuid"]) {
      expect(await problemOf(await leave(marta, spaceId))).toEqual([404, "SpaceNotFound"]);
    }
  });
});
