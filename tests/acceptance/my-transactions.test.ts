import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as myActivity } from "@/app/api/v1/me/activity/route";
import { GET as myTransactions } from "@/app/api/v1/me/transactions/route";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { POST as createSpace } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  categoryWithKey,
  cop,
  household,
  memberIdOf,
  paysEqually,
  post,
  type HouseholdMember,
  type MoneyDto,
} from "../support/ledger";
import { actingIn } from "../support/spaces";

let app: Container;
beforeAll(() => {
  // 2026-10-28 in Bogotá: the current period of a MONTHLY(1) personal space is 2026-10.
  app = startTestApp({ clock: new FixedClock(new Date("2026-10-28T15:00:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface ItemDto {
  space: { id: string; name: string; kind: string };
  transaction: { id: string; type: string; description: string; amount: MoneyDto };
  recordedBy: { name: string | null; you: boolean };
  you: { memberIds: string[]; share: MoneyDto | null; paid: MoneyDto | null };
}
interface PageDto {
  period: { label: string; startDate: string; endDate: string };
  totals: { share: MoneyDto; income: MoneyDto };
  items: ItemDto[];
  nextCursor: string | null;
}

const pageOf = async (user: TestUser, query = ""): Promise<PageDto> => {
  const response = await call(myTransactions, "GET", `/api/v1/me/transactions${query}`, { user });
  expect(response.status).toBe(200);
  return (await response.json()) as PageDto;
};
const idsOf = async (user: TestUser, query = "") =>
  (await pageOf(user, query)).items.map((i) => i.transaction.id);
const idOf = async (response: Response) => {
  const body = (await response.json()) as { id: string };
  expect([response.status, body]).toEqual([201, expect.objectContaining({ id: expect.any(String) })]);
  return body.id;
};

/** A space of Ana alone (`currency`), with one expense of `amount` minor units paid from its shared fund. */
const spaceOfHerOwn = async (ana: HouseholdMember, name: string, currency: string, amount: string) => {
  const created = await call(createSpace, "POST", "/api/v1/spaces", {
    user: ana.personal,
    body: { kind: "SHARED", name, currency },
  });
  const spaceId = await idOf(created);
  const inIt = actingIn(ana.personal, spaceId);
  const memberId = await memberIdOf(ana.personal, spaceId, "Ana");
  const accountId = await idOf(
    await call(createAccount, "POST", `/api/v1/spaces/${spaceId}/accounts`, {
      user: inIt,
      params: { spaceId },
      body: { name: `${name} fund`, type: "SHARED_FUND", openingBalance: { amount: amount, currency } },
    }),
  );
  const expense = await idOf(
    await post(recordExpense, inIt, "expenses", {
      description: `${name} expense`,
      date: "2026-10-06",
      categoryId: await categoryWithKey(inIt, "groceries"),
      amount: { amount, currency },
      payments: [{ memberId: null, accountId, amount: { amount, currency } }],
      split: { method: "EQUAL", participants: [{ memberId }] },
    }),
  );
  return { spaceId, expense };
};

/**
 * Ana's October: a market and her salary in her personal space, groceries Juan paid in the household (her half is
 * 90.000), a hotel in a USD trip, and an archived space of her own; Juan's own lunch is never hers.
 */
const october = async () => {
  const h = await household();
  const market = await idOf(
    await post(recordExpense, h.ana.personal, "expenses", {
      description: "Market",
      amount: cop(30_000),
      date: "2026-10-04",
      categoryId: await categoryWithKey(h.ana.personal, "groceries"),
      accountId: h.ana.account,
    }),
  );
  const salary = await idOf(
    await post(recordIncome, h.ana.personal, "incomes", {
      description: "Salary",
      amount: cop(3_000_000),
      date: "2026-10-25",
      categoryId: await categoryWithKey(h.ana.personal, "salary"),
      accountId: h.ana.account,
    }),
  );
  const groceries = (
    await paysEqually(h.juan, 180_000, [h.ana.memberId, h.juan.memberId], h.groceries, "Mercado del mes")
  ).id;
  const lunch = await idOf(
    await post(recordExpense, h.juan.personal, "expenses", {
      description: "Juan's lunch",
      amount: cop(20_000),
      date: "2026-10-07",
      categoryId: await categoryWithKey(h.juan.personal, "groceries"),
      accountId: h.juan.account,
    }),
  );
  const trip = await spaceOfHerOwn(h.ana, "Trip", "USD", "10000");
  const old = await spaceOfHerOwn(h.ana, "Old", "COP", "1000000");
  const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${old.spaceId}/archive`, {
    user: h.ana.personal,
    params: { spaceId: old.spaceId },
  });
  expect(archived.status).toBe(204);
  return { h, market, salary, groceries, lunch, trip, old };
};

describe("GET /api/v1/me/transactions (ruling P319)", () => {
  it("lists Ana's movements of every current space in the current period, newest first, with her part", async () => {
    const w = await october();
    const page = await pageOf(w.h.ana);
    expect(page.period).toEqual({ label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(page.items.map((i) => [i.transaction.id, i.space.kind])).toEqual([
      [w.salary, "PERSONAL"],
      [w.trip.expense, "SHARED"],
      [w.groceries, "SHARED"],
      [w.market, "PERSONAL"],
    ]);
    expect(page.items[2]).toMatchObject({
      space: { id: w.h.spaceId },
      recordedBy: { name: "Juan", you: false },
      you: { memberIds: [w.h.ana.memberId], share: cop(90_000), paid: null },
    });
    // P37: the USD trip is listed with its own amounts, but stays out of the COP sums.
    expect(page.items[1]!.you.share).toEqual({ amount: "10000", currency: "USD" });
    expect(page.totals).toEqual({ share: cop(120_000), income: cop(3_000_000) });
    expect(page.nextCursor).toBeNull();
    expect(await idsOf(w.h.juan)).toEqual([w.lunch, w.groceries]);
  });

  it("describes a shared movement exactly as /me/activity does", async () => {
    const w = await october();
    const response = await call(myActivity, "GET", "/api/v1/me/activity?from=2026-10-01", { user: w.h.ana });
    const { items: activity } = (await response.json()) as { items: ItemDto[] };
    const listed = (await pageOf(w.h.ana)).items.filter((i) => i.space.kind !== "PERSONAL");
    expect(listed).toEqual(activity);
  });

  it("narrows to one of her spaces, and answers 404 for a space that is not one of her current ones", async () => {
    const w = await october();
    const household = await pageOf(w.h.ana, `?spaceId=${w.h.spaceId}`);
    expect(household.items.map((i) => i.transaction.id)).toEqual([w.groceries]);
    expect(household.totals).toEqual({ share: cop(90_000), income: cop(0) });
    const trip = await pageOf(w.h.ana, `?spaceId=${w.trip.spaceId}`);
    expect(trip.items.map((i) => i.transaction.id)).toEqual([w.trip.expense]);
    expect(trip.totals).toEqual({ share: cop(0), income: cop(0) });
    for (const spaceId of [w.h.juan.personal.spaceId, w.old.spaceId]) {
      const response = await call(myTransactions, "GET", `/api/v1/me/transactions?spaceId=${spaceId}`, {
        user: w.h.ana,
      });
      expect(await problemOf(response)).toEqual([404, "SpaceNotFound"]);
    }
  });

  it("filters by category in any space, account, type and description, totals included (P277)", async () => {
    const w = await october();
    const personalGroceries = await categoryWithKey(w.h.ana.personal, "groceries");
    expect(await idsOf(w.h.ana, `?categoryIds=${w.h.groceries},${personalGroceries}`)).toEqual([
      w.groceries,
      w.market,
    ]);
    expect(await idsOf(w.h.ana, `?accountId=${w.h.ana.account}`)).toEqual([w.salary, w.market]);
    const incomes = await pageOf(w.h.ana, "?type=INCOME");
    expect(incomes.items.map((i) => i.transaction.id)).toEqual([w.salary]);
    expect(incomes.totals).toEqual({ share: cop(0), income: cop(3_000_000) });
    expect(await idsOf(w.h.ana, "?search=%20mERCADO%20")).toEqual([w.groceries]);
    // The household's own list still reads its filters as before.
    const response = await call(
      listTransactions,
      "GET",
      `/api/v1/spaces/${w.h.spaceId}/transactions?period=2026-10&categoryIds=${w.h.groceries}&search=mercado`,
      { user: w.h.ana, params: { spaceId: w.h.spaceId } },
    );
    const own = (await response.json()) as { items: { id: string }[]; totals: { expenses: MoneyDto } };
    expect(own.items.map((t) => t.id)).toEqual([w.groceries]);
    expect(own.totals.expenses).toEqual(cop(180_000));
  });

  it("reads a period of her personal space by its label and refuses an unknown one", async () => {
    const w = await october();
    expect(await idsOf(w.h.ana, "?period=2026-10")).toHaveLength(4);
    expect(await pageOf(w.h.ana, "?period=2026-09")).toMatchObject({
      period: { label: "2026-09" },
      items: [],
      totals: { share: cop(0), income: cop(0) },
    });
    const response = await call(myTransactions, "GET", "/api/v1/me/transactions?period=2026-13", {
      user: w.h.ana,
    });
    expect(await problemOf(response)).toEqual([422, "InvalidPeriodLabel"]);
  });

  it("pages through every space with a cursor, without repeating or skipping a movement (P43)", async () => {
    const w = await october();
    const first = await pageOf(w.h.ana, "?limit=3");
    expect(first.items.map((i) => i.transaction.id)).toEqual([w.salary, w.trip.expense, w.groceries]);
    expect(first.nextCursor).not.toBeNull();
    const rest = await pageOf(w.h.ana, `?limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(rest.items.map((i) => i.transaction.id)).toEqual([w.market]);
    expect(rest.nextCursor).toBeNull();
    expect(rest.totals).toEqual(first.totals);
  });

  it("refuses a malformed cursor, and a request without a session", async () => {
    const w = await october();
    const bad = await call(myTransactions, "GET", "/api/v1/me/transactions?cursor=nonsense", {
      user: w.h.ana,
    });
    expect(await problemOf(bad)).toEqual([422, "InvalidCursor"]);
    const anonymous = await call(myTransactions, "GET", "/api/v1/me/transactions");
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });
});
