import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { GET as getMyBalances } from "@/app/api/v1/me/balances/route";
import { GET as listFriends } from "@/app/api/v1/me/friends/route";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as getBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";
import { GET as getSuggestions } from "@/app/api/v1/spaces/[spaceId]/balances/suggestions/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { GET as historyRoute } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/balance-history/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  cop,
  household,
  paysEqually,
  post,
  type Household,
  type HouseholdMember,
  type MoneyDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Whole dollars on the wire: USD has two minor digits. */
const usd = (dollars: number): MoneyDto => ({ amount: String(dollars * 100), currency: "USD" });

/** A USD account of `member`'s, opened in their personal space as the household's accounts are. */
const usdAccount = async (member: HouseholdMember): Promise<string> => {
  const response = await call(createAccount, "POST", `/api/v1/spaces/${member.personal.spaceId}/accounts`, {
    user: member.personal,
    params: { spaceId: member.personal.spaceId },
    body: { name: "Dólares", type: "BANK", currency: "USD", openingBalance: usd(0) },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/**
 * Ruling P342 (S4): Ana pays 300,000 COP split equally (Juan owes her 150,000 COP), and Juan pays 100 USD from his USD
 * account split equally (Ana owes him 50 USD). The currencies never net against each other.
 */
const copAndUsdDebts = async (): Promise<Household> => {
  const h = await household();
  await paysEqually(h.ana, 300_000, [h.ana.memberId, h.juan.memberId], h.groceries);
  await juanPaysUsdTaxi(h);
  return h;
};

/** Juan pays a 100 USD taxi from his USD account, split equally with Ana (she owes him 50 USD). */
const juanPaysUsdTaxi = async (h: Household) => {
  const account = await usdAccount(h.juan);
  const response = await post(recordExpense, h.juan, "expenses", {
    description: "Taxi in Miami",
    date: "2026-10-06",
    categoryId: h.groceries,
    amount: usd(100),
    payments: [{ memberId: h.juan.memberId, accountId: account, amount: usd(100) }],
    split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
  });
  expect(response.status).toBe(201);
};

interface BalancesDto {
  members: { memberId: string; net: MoneyDto; nets?: MoneyDto[]; hasMovements?: boolean }[];
}
const balancesOf = async (user: TestUser, spaceId: string): Promise<BalancesDto> => {
  const response = await call(getBalances, "GET", `/api/v1/spaces/${spaceId}/balances`, {
    user,
    params: { spaceId },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as BalancesDto;
};

const suggestionsOf = async (user: TestUser, spaceId: string) => {
  const response = await call(getSuggestions, "GET", `/api/v1/spaces/${spaceId}/balances/suggestions`, {
    user,
    params: { spaceId },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { suggestions: unknown[] }).suggestions;
};

const myBalancesOf = async (user: TestUser) => {
  const response = await call(getMyBalances, "GET", "/api/v1/me/balances", { user });
  expect(response.status).toBe(200);
  return (
    (await response.json()) as {
      items: { spaceId: string; net: MoneyDto; nets?: MoneyDto[]; payments: unknown[] }[];
    }
  ).items;
};

const historyOf = (user: TestUser, spaceId: string, memberId: string, query = "") =>
  call(historyRoute, "GET", `/api/v1/spaces/${spaceId}/members/${memberId}/balance-history${query}`, {
    user,
    params: { spaceId, memberId },
  });

describe("balances per currency over HTTP (P342 S4)", () => {
  it("gives every member a net per currency, the space's first, and keeps `net` in the space's currency", async () => {
    const h = await copAndUsdDebts();
    expect(await balancesOf(h.ana, h.spaceId)).toEqual({
      members: [
        { memberId: h.ana.memberId, net: cop(150_000), nets: [cop(150_000), usd(-50)], hasMovements: true },
        { memberId: h.juan.memberId, net: cop(-150_000), nets: [cop(-150_000), usd(50)], hasMovements: true },
      ],
    });
  });

  it("suggests each debt in its own currency", async () => {
    const h = await copAndUsdDebts();
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([
      { payerMemberId: h.juan.memberId, receivingMemberId: h.ana.memberId, amount: cop(150_000) },
      { payerMemberId: h.ana.memberId, receivingMemberId: h.juan.memberId, amount: usd(50) },
    ]);
  });

  it("lists Ana's nets per currency in /me/balances, and her USD payment to Juan", async () => {
    const h = await copAndUsdDebts();
    const item = (await myBalancesOf(h.ana)).find((b) => b.spaceId === h.spaceId);
    expect(item).toMatchObject({
      net: cop(150_000),
      nets: [cop(150_000), usd(-50)],
      payments: [{ receivingMemberId: h.juan.memberId, amount: usd(50) }],
    });
  });

  it("reads one currency's history with ?currency=, and refuses an unknown code with 422 UnknownCurrency", async () => {
    const h = await copAndUsdDebts();
    const response = await historyOf(h.ana, h.spaceId, h.ana.memberId, "?currency=USD");
    expect(response.status).toBe(200);
    const history = (await response.json()) as {
      opening: MoneyDto;
      closing: MoneyDto;
      entries: { description: string; change: MoneyDto; balance: MoneyDto }[];
    };
    expect(history).toMatchObject({ opening: usd(0), closing: usd(-50) });
    expect(history.entries).toEqual([
      expect.objectContaining({ description: "Taxi in Miami", change: usd(-50), balance: usd(-50) }),
    ]);

    const spaceCurrency = (await (await historyOf(h.ana, h.spaceId, h.ana.memberId)).json()) as {
      closing: MoneyDto;
      entries: unknown[];
    };
    expect(spaceCurrency.closing).toEqual(cop(150_000));
    expect(spaceCurrency.entries).toHaveLength(1);

    expect(await problemOf(await historyOf(h.ana, h.spaceId, h.ana.memberId, "?currency=XYZ"))).toEqual([
      422,
      "UnknownCurrency",
    ]);
    expect(await problemOf(await historyOf(h.ana, h.spaceId, h.ana.memberId, "?currency=DOLLARS"))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("gives a friend's nets per currency in /me/friends", async () => {
    const h = await household();
    const split = async (amount: MoneyDto, paid: { accountId: string } | { paidBy: "COUNTERPART" }) => {
      const response = await call(directSplit, "POST", "/api/v1/direct-splits", {
        user: h.ana,
        body: {
          counterpart: { kind: "MEMBER", memberId: h.juan.memberId },
          description: "Cena",
          date: "2026-10-05",
          categoryKey: "restaurants",
          amount,
          ...paid,
        },
      });
      expect(response.status).toBe(201);
    };
    // Ana pays a 120,000 COP dinner with Juan (he owes her 60,000 COP); Juan pays a 40 USD taxi (she owes him 20 USD).
    await split(cop(120_000), { accountId: h.ana.account });
    await split(usd(40), { paidBy: "COUNTERPART" });
    const response = await call(listFriends, "GET", "/api/v1/me/friends", { user: h.ana });
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as {
      items: { name: string; net: MoneyDto; nets?: MoneyDto[] }[];
    };
    expect(items.find((f) => f.name === "Juan")).toMatchObject({
      net: cop(60_000),
      nets: [cop(60_000), usd(-20)],
    });
  });

  it("refuses leaving while owed in another currency only, naming that currency in OutstandingBalance", async () => {
    const h = await household();
    await juanPaysUsdTaxi(h);
    // Even in COP, owed 50 USD: the problem names the USD amount, not a converted one.
    expect(await balancesOf(h.ana, h.spaceId)).toMatchObject({
      members: [
        { memberId: h.ana.memberId, net: cop(0), nets: [usd(-50)] },
        { memberId: h.juan.memberId, net: cop(0), nets: [usd(50)] },
      ],
    });
    const response = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: h.juan,
      params: { spaceId: h.spaceId },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OutstandingBalance", outstanding: usd(50) });
  });

  it("keeps a single-currency space's answers as before, plus `nets` (empty when even)", async () => {
    const h = await household();
    expect(await balancesOf(h.ana, h.spaceId)).toEqual({
      members: [
        { memberId: h.ana.memberId, net: cop(0), nets: [], hasMovements: false },
        { memberId: h.juan.memberId, net: cop(0), nets: [], hasMovements: false },
      ],
    });
    await paysEqually(h.ana, 300_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual({
      members: [
        { memberId: h.ana.memberId, net: cop(150_000), nets: [cop(150_000)], hasMovements: true },
        { memberId: h.juan.memberId, net: cop(-150_000), nets: [cop(-150_000)], hasMovements: true },
      ],
    });
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([
      { payerMemberId: h.juan.memberId, receivingMemberId: h.ana.memberId, amount: cop(150_000) },
    ]);
    const item = (await myBalancesOf(h.juan)).find((b) => b.spaceId === h.spaceId);
    expect(item).toMatchObject({
      net: cop(-150_000),
      nets: [cop(-150_000)],
      payments: [{ receivingMemberId: h.ana.memberId, amount: cop(150_000) }],
    });
  });
});
