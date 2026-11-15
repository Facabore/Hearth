import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as myTransactions } from "@/app/api/v1/me/transactions/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  balanceOf,
  balancesOf,
  cop,
  household,
  post,
  type Household,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  // 2026-10-31 in Bogotá: the current period of a MONTHLY(1) personal space is 2026-10.
  app = startTestApp({ clock: new FixedClock(new Date("2026-10-31T15:00:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Ana records a 150,000 COP dinner in the household that `payment` paid, shared equally by Ana and Juan. */
const dinnerPaidBy = (h: Household, payment: { memberId: string; accountId: string | null }) =>
  post(recordExpense, h.ana, "expenses", {
    description: "Cena",
    date: "2026-10-14",
    categoryId: h.groceries,
    amount: cop(150_000),
    payments: [{ ...payment, amount: cop(150_000) }],
    split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
  });

interface FeedItem {
  transaction: { id: string };
  you: { paid: MoneyDto | null; share: MoneyDto | null };
}
const feedOf = async (user: TestUser): Promise<FeedItem[]> => {
  const response = await call(myTransactions, "GET", "/api/v1/me/transactions", { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: FeedItem[] }).items;
};

describe("Juan paid with his own money (P333, P168 amended)", () => {
  it("records who owes whom, moves none of Juan's accounts and shows in Juan's personal feed", async () => {
    const h = await household();
    const response = await dinnerPaidBy(h, { memberId: h.juan.memberId, accountId: null });
    expect(response.status).toBe(201);
    const expense = (await response.json()) as TransactionDto;
    expect(expense.payments).toEqual([{ memberId: h.juan.memberId, accountId: null, amount: cop(150_000) }]);
    expect(Object.fromEntries(await balancesOf(h.ana, h.spaceId))).toEqual({
      [h.ana.memberId]: cop(-75_000),
      [h.juan.memberId]: cop(75_000),
    });
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(2_000_000));
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(2_000_000));
    const juans = (await feedOf(h.juan.personal)).find((item) => item.transaction.id === expense.id);
    expect(juans?.you).toMatchObject({ paid: cop(150_000), share: cop(75_000) });
  });

  it("still asks the recorder for an account when they paid themself", async () => {
    const h = await household();
    expect(await problemOf(await dinnerPaidBy(h, { memberId: h.ana.memberId, accountId: null }))).toEqual([
      422,
      "AccountRequired",
    ]);
  });
});
