import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as personalTrendRoute } from "@/app/api/v1/me/trend/route";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as createSpace } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, household, newAccount, post, type HouseholdMember } from "../support/ledger";
import { getPersonalTrend, type PersonalTrendDto } from "../support/reporting";
import { actingIn } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const trendOf = async (user: TestUser, query: Record<string, string | number>): Promise<PersonalTrendDto> => {
  const response = await getPersonalTrend(user, query);
  expect(response.status).toBe(200);
  return (await response.json()) as PersonalTrendDto;
};

const usd = (cents: number) => ({ amount: String(cents), currency: "USD" });

/** `member` records an expense in their own personal space, from their own account. */
const spendAtHome = async (member: HouseholdMember, pesos: number, date: string) => {
  const response = await post(recordExpense, member.personal, "expenses", {
    description: "Personal",
    date,
    categoryId: await categoryWithKey(member.personal, "groceries"),
    amount: cop(pesos),
    accountId: member.account,
  });
  expect(response.status).toBe(201);
};

/** `ana` spends `pesos` on `date` from `account` in her personal space, one expense per entry. */
const spendAll = async (ana: TestUser, account: string, spent: readonly (readonly [string, number])[]) => {
  const groceries = await categoryWithKey(ana, "groceries");
  for (const [date, pesos] of spent) {
    const response = await post(recordExpense, ana, "expenses", {
      description: "Market",
      date,
      categoryId: groceries,
      amount: cop(pesos),
      accountId: account,
    });
    expect(response.status).toBe(201);
  }
};

describe("personal trend over HTTP (HU-E7-05)", () => {
  it("returns six consumption values from 2026-06 to 2026-11, each compared with the period before", async () => {
    const ana = await registerUser("Ana");
    const account = await newAccount(ana, "Bancolombia", 5_000_000);
    await spendAll(ana, account, [
      ["2026-05-20", 100_000],
      ["2026-06-03", 200_000],
      ["2026-07-03", 150_000],
      ["2026-08-03", 150_000],
      ["2026-09-30", 300_000],
      ["2026-10-01", 270_000],
      ["2026-11-30", 297_000],
    ]);
    const response = await getPersonalTrend(ana, { endPeriod: "2026-11" });
    expect(response.status).toBe(200);
    const trend = (await response.json()) as PersonalTrendDto;
    expect(trend.periods.map((p) => p.label)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(trend.points.map((p) => [p.period, p.consumption, p.changePercent, p.changeStatus])).toEqual([
      ["2026-06", cop(200_000), "100.00", "INCREASED"],
      ["2026-07", cop(150_000), "-25.00", "DECREASED"],
      ["2026-08", cop(150_000), "0.00", "UNCHANGED"],
      ["2026-09", cop(300_000), "100.00", "INCREASED"],
      ["2026-10", cop(270_000), "-10.00", "DECREASED"],
      ["2026-11", cop(297_000), "10.00", "INCREASED"],
    ]);
  });

  it("refuses a missing end period, a window over 24 periods and a label the personal policy does not name", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await getPersonalTrend(ana, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await getPersonalTrend(ana, { endPeriod: "2026-11", periods: 25 }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await getPersonalTrend(ana, { endPeriod: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });

  it("answers 401 without a session", async () => {
    const anonymous = await call(personalTrendRoute, "GET", "/api/v1/me/trend?endPeriod=2026-11");
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });

  it("answers NEW, without a change or a percentage, after a period without spending, which counts 0", async () => {
    const ana = await registerUser("Ana");
    const account = await newAccount(ana, "Bancolombia", 5_000_000);
    await spendAll(ana, account, [
      ["2026-09-10", 100_000],
      ["2026-11-10", 120_000],
    ]);
    const trend = await trendOf(ana, { endPeriod: "2026-11", periods: 3 });
    expect(trend.currency).toBe("COP");
    expect(trend.points).toEqual([
      {
        period: "2026-09",
        consumption: cop(100_000),
        change: null,
        changePercent: null,
        changeStatus: "NEW",
      },
      {
        period: "2026-10",
        consumption: cop(0),
        change: cop(-100_000),
        changePercent: "-100.00",
        changeStatus: "DECREASED",
      },
      {
        period: "2026-11",
        consumption: cop(120_000),
        change: null,
        changePercent: null,
        changeStatus: "NEW",
      },
    ]);
  });

  it("takes the edges of the window: one period is compared with the period before it, 24 periods fill it", async () => {
    const ana = await registerUser("Ana");
    const account = await newAccount(ana, "Bancolombia", 5_000_000);
    await spendAll(ana, account, [
      ["2026-10-10", 80_000],
      ["2026-11-10", 100_000],
    ]);
    const one = await trendOf(ana, { endPeriod: "2026-11", periods: 1 });
    expect(one.periods.map((p) => p.label)).toEqual(["2026-11"]);
    expect(one.points.map((p) => [p.consumption, p.change, p.changePercent, p.changeStatus])).toEqual([
      [cop(100_000), cop(20_000), "25.00", "INCREASED"],
    ]);
    const widest = await trendOf(ana, { endPeriod: "2026-11", periods: 24 });
    expect(widest.periods).toHaveLength(24);
    expect(widest.points).toHaveLength(24);
    expect(widest.periods[0]?.label).toBe("2024-12");
    expect(widest.periods[23]?.label).toBe("2026-11");
    for (const periods of [0, 1.5, -1, "six", ""]) {
      expect(await problemOf(await getPersonalTrend(ana, { endPeriod: "2026-11", periods }))).toEqual([
        422,
        "ValidationFailed",
      ]);
    }
  });

  it("never counts another member's personal space: Juan's spending is in his trend only (@critical)", async () => {
    const h = await household();
    await spendAtHome(h.ana, 80_000, "2026-10-05");
    await spendAtHome(h.ana, 100_000, "2026-11-05");
    await spendAtHome(h.juan, 500_000, "2026-10-06");
    await spendAtHome(h.juan, 900_000, "2026-11-06");
    // A shared EQUAL expense counts for each member by their own share only.
    const shared = await post(recordExpense, h.ana, "expenses", {
      description: "Weekly market",
      date: "2026-11-12",
      categoryId: h.groceries,
      amount: cop(200_000),
      accountId: h.ana.account,
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    });
    expect(shared.status).toBe(201);
    const ana = await trendOf(h.ana.personal, { endPeriod: "2026-11", periods: 2 });
    expect(ana.points.map((p) => [p.period, p.consumption, p.changePercent, p.changeStatus])).toEqual([
      ["2026-10", cop(80_000), null, "NEW"],
      ["2026-11", cop(200_000), "150.00", "INCREASED"],
    ]);
    const juan = await trendOf(h.juan.personal, { endPeriod: "2026-11", periods: 2 });
    expect(juan.points.map((p) => [p.period, p.consumption])).toEqual([
      ["2026-10", cop(500_000)],
      ["2026-11", cop(1_000_000)],
    ]);
  });

  it("keeps the personal currency: a USD space of the caller does not enter their COP trend", async () => {
    const ana = await registerUser("Ana");
    const created = await call(createSpace, "POST", "/api/v1/spaces", {
      user: ana,
      body: { kind: "SHARED", name: "Miami", currency: "USD" },
    });
    expect(created.status).toBe(201);
    const miami = actingIn(ana, ((await created.json()) as { id: string }).id);
    const account = await call(createAccount, "POST", `/api/v1/spaces/${miami.spaceId}/accounts`, {
      user: miami,
      params: { spaceId: miami.spaceId },
      body: { name: "Miami Fund", type: "SHARED_FUND", openingBalance: usd(100_000) },
    });
    expect(account.status).toBe(201);
    const spent = await post(recordExpense, miami, "expenses", {
      description: "Dinner",
      date: "2026-11-05",
      categoryId: await categoryWithKey(miami, "restaurants"),
      amount: usd(5_000),
      payments: [
        { memberId: null, accountId: ((await account.json()) as { id: string }).id, amount: usd(5_000) },
      ],
    });
    expect(spent.status).toBe(201);
    const trend = await trendOf(ana, { endPeriod: "2026-11", periods: 2 });
    expect(trend.currency).toBe("COP");
    expect(trend.points.map((p) => p.consumption)).toEqual([cop(0), cop(0)]);
  });
});
