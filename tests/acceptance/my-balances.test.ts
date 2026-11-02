import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMyBalances } from "@/app/api/v1/me/balances/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { cop, household, joinHousehold, post, type MoneyDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface MyBalanceDto {
  spaceId: string;
  memberId: string;
  net: MoneyDto;
  members: { memberId: string; name: string }[];
  payments: { receivingMemberId: string; amount: MoneyDto }[];
}

const myBalancesOf = async (user: TestUser): Promise<MyBalanceDto[]> => {
  const response = await call(getMyBalances, "GET", "/api/v1/me/balances", { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: MyBalanceDto[] }).items;
};

describe("GET /api/v1/me/balances (#240, P277)", () => {
  it("gives Ana her turn to put 100,000 COP to Juan in the household, with its members by name", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    // Juan pays 150,000 COP from his account for Ana (100,000) and Luis (50,000).
    const response = await post(recordExpense, h.juan, "expenses", {
      description: "Trip",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(150_000),
      payments: [{ memberId: h.juan.memberId, accountId: h.juan.account, amount: cop(150_000) }],
      split: {
        method: "EXACT",
        participants: [
          { memberId: h.ana.memberId, amount: cop(100_000) },
          { memberId: luis.memberId, amount: cop(50_000) },
        ],
      },
    });
    expect(response.status).toBe(201);
    expect(await myBalancesOf(h.ana)).toEqual([
      {
        spaceId: h.spaceId,
        memberId: h.ana.memberId,
        net: cop(-100_000),
        members: [
          { memberId: h.ana.memberId, name: "Ana" },
          { memberId: h.juan.memberId, name: "Juan" },
          { memberId: luis.memberId, name: "Luis" },
        ],
        payments: [{ receivingMemberId: h.juan.memberId, amount: cop(100_000) }],
      },
    ]);
    const [juans] = await myBalancesOf(h.juan);
    expect(juans).toMatchObject({ memberId: h.juan.memberId, net: cop(150_000), payments: [] });
  });

  it("answers an empty list to someone with only her personal space", async () => {
    expect(await myBalancesOf(await registerUser("Sola"))).toEqual([]);
  });

  it("answers 401 without a session", async () => {
    const response = await call(getMyBalances, "GET", "/api/v1/me/balances", {});
    expect(response.status).toBe(401);
  });
});
