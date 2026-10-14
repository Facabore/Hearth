import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { DELETE as deleteTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import {
  addGuest,
  balancesOf,
  cop,
  household,
  joinHousehold,
  newAccount,
  post,
  type Household,
  type HouseholdMember,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const equal = (...memberIds: string[]) => ({
  method: "EQUAL",
  participants: memberIds.map((memberId) => ({ memberId })),
});
/** `payer` pays `pesos` from their own account, split equally among `participants`. */
const pay = async (h: Household, payer: HouseholdMember, pesos: number, participants: string[]) => {
  const response = await post(recordExpense, payer, "expenses", {
    description: "Groceries",
    date: "2026-10-05",
    categoryId: h.groceries,
    amount: cop(pesos),
    payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
    split: equal(...participants),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionDto;
};
const sumOf = (nets: [string, { amount: string }][]) =>
  nets.reduce((sum, [, net]) => sum + BigInt(net.amount), 0n);

describe("balances in a shared space (HU-E5-01)", () => {
  it("turns one equal split into a debt: Juan owes Ana 150,000 COP (@critical)", async () => {
    const h = await household();
    await pay(h, h.ana, 300_000, [h.ana.memberId, h.juan.memberId]);
    expect(await balancesOf(h.juan, h.spaceId)).toEqual([
      [h.ana.memberId, cop(150_000)],
      [h.juan.memberId, cop(-150_000)],
    ]);
  });

  it("nets debts out across expenses", async () => {
    const h = await household();
    const both = [h.ana.memberId, h.juan.memberId];
    await pay(h, h.ana, 300_000, both);
    await pay(h, h.juan, 100_000, both);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(100_000)],
      [h.juan.memberId, cop(-100_000)],
    ]);
  });

  it("leaves the nets unchanged when an expense is paid from the shared fund (HU-E4-10, D5)", async () => {
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 1_500_000, "SHARED_FUND");
    await pay(h, h.ana, 300_000, [h.ana.memberId, h.juan.memberId]);
    const before = await balancesOf(h.ana, h.spaceId);
    const rent = await post(recordExpense, h.ana, "expenses", {
      description: "Rent October",
      date: "2026-10-01",
      categoryId: h.groceries,
      amount: cop(1_200_000),
      payments: [{ memberId: null, accountId: fund, amount: cop(1_200_000) }],
      split: {
        method: "PERCENT",
        participants: [
          { memberId: h.ana.memberId, percent: "40" },
          { memberId: h.juan.memberId, percent: "60" },
        ],
      },
    });
    expect(rent.status).toBe(201);
    const after = await balancesOf(h.ana, h.spaceId);
    expect(after).toEqual(before);
    expect(after).toEqual([
      [h.ana.memberId, cop(150_000)],
      [h.juan.memberId, cop(-150_000)],
    ]);
  });

  it("excludes soft-deleted expenses (Review Focus 5)", async () => {
    const h = await household();
    const tx = await pay(h, h.ana, 300_000, [h.ana.memberId, h.juan.memberId]);
    const deleted = await call(
      deleteTransaction,
      "DELETE",
      `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`,
      {
        user: h.ana,
        params: { spaceId: h.spaceId, transactionId: tx.id },
      },
    );
    expect(deleted.status).toBe(204);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
  });

  it("includes guests, and the balances sum to zero (Review Focus 5)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const taxi = await post(recordExpense, h.ana, "expenses", {
      description: "Taxi",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: pedro, accountId: null, amount: cop(90_000) }],
      split: equal(h.ana.memberId, h.juan.memberId, pedro),
    });
    expect(taxi.status).toBe(201);
    const nets = await balancesOf(h.ana, h.spaceId);
    expect(nets).toEqual([
      [h.ana.memberId, cop(-30_000)],
      [h.juan.memberId, cop(-30_000)],
      [pedro, cop(60_000)],
    ]);
    expect(sumOf(nets)).toBe(0n);
  });

  it("lets a viewer read the balances (Review Focus 2)", async () => {
    const h = await household();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect(await balancesOf(sofi, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [sofi.memberId, cop(0)],
    ]);
  });

  it("answers a non-member and a malformed space id with 404 SpaceNotFound, never 500 (Review Focus 2)", async () => {
    const h = await household();
    const marta = await registerUser("Marta");
    for (const spaceId of [h.spaceId, "not-a-uuid"]) {
      const response = await call(getBalances, "GET", `/api/v1/spaces/${spaceId}/balances`, {
        user: marta,
        params: { spaceId },
      });
      expect(await problemOf(response)).toEqual([404, "SpaceNotFound"]);
    }
  });
});
