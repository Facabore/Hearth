import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { GET as personalSpendingByGroupRoute } from "@/app/api/v1/me/reports/spending-by-group/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { POST as createSpace } from "@/app/api/v1/spaces/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { activatePlan } from "../support/budgeting";
import {
  addGuest,
  categoryWithKey,
  cop,
  household,
  inSpace,
  joinHousehold,
  memberIdOf,
  newAccount,
  post,
  type HouseholdMember,
} from "../support/ledger";
import {
  contribute,
  getLineDashboard,
  getPersonalSpendingByGroup,
  getSpendingByGroup,
  getUnifiedView,
  groupWithKey,
  newCategory,
  newCategoryGroup,
  reportHousehold,
  spend,
  type LineDashboardDto,
  type PersonalSpendingByGroupDto,
  type SpendingByGroupDto,
  type UnifiedViewDto,
} from "../support/reporting";
import { actingIn, claimLink, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const viewOf = async (user: TestUser, period = "2026-11"): Promise<UnifiedViewDto> => {
  const response = await getUnifiedView(user, { period });
  expect(response.status).toBe(200);
  return (await response.json()) as UnifiedViewDto;
};

/** `member` records an expense in their own personal space, from their own account. */
const spendAtHome = async (member: HouseholdMember, key: string, pesos: number, date: string) => {
  const response = await post(recordExpense, member.personal, "expenses", {
    description: "Personal",
    date,
    categoryId: await categoryWithKey(member.personal, key),
    amount: cop(pesos),
    accountId: member.account,
  });
  expect(response.status).toBe(201);
};

/**
 * HU-E7-04 Background: Ana's personal Market (85,000) and Dinner (60,000); in Household, under its ACTIVE 2026-11
 * plan, her 2,000,000 COP Home purchase and the fund's 1,200,000 COP Rent split BY_ALLOCATION (40 %), Juan's
 * 300,000 COP market split EQUAL, and her 480,000 COP fund contribution from Bancolombia on 2026-11-01.
 */
const background = async () => {
  const r = await reportHousehold();
  const { h, category, fund } = r;
  expect((await activatePlan(h.ana, h.spaceId, r.planId)).status).toBe(200);
  await spendAtHome(h.ana, "groceries", 85_000, "2026-11-03");
  await spendAtHome(h.ana, "restaurants", 60_000, "2026-11-04");
  await spend(h.ana, category.groceries, 2_000_000, "2026-11-05");
  await spend(h.ana, category.rent, 1_200_000, "2026-11-01", fund);
  const market = await post(recordExpense, h.juan, "expenses", {
    description: "Weekly market",
    date: "2026-11-12",
    categoryId: category.groceries,
    amount: cop(300_000),
    payments: [{ memberId: h.juan.memberId, accountId: h.juan.account, amount: cop(300_000) }],
    split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
  });
  expect(market.status).toBe(201);
  await contribute(h.ana, fund, 480_000, "2026-11-01");
  return r;
};

describe("unified personal view over HTTP (HU-E7-04)", () => {
  it("totals Ana's consumption across spaces, Groceries of both under the key groceries (@critical)", async () => {
    const { h } = await background();
    const view = await viewOf(h.ana);
    expect(view.consumption.total).toEqual(cop(1_575_000));
    expect(view.consumption.categories).toEqual([
      // Named as Ana's personal space names each key (ruling P76), seeded in Spanish.
      { key: "groceries", name: "Mercado", space: null, category: null, amount: cop(1_035_000) },
      { key: "rent", name: "Arriendo", space: null, category: null, amount: cop(480_000) },
      { key: "restaurants", name: "Restaurantes", space: null, category: null, amount: cop(60_000) },
    ]);
  });

  it("reports Ana's cash out of 2,625,000 COP, the fund contribution included, apart from consumption (@critical)", async () => {
    const { h } = await background();
    const view = await viewOf(h.ana);
    expect(view.cashOut).toEqual({
      total: cop(2_625_000),
      payments: cop(2_145_000),
      fundContributions: cop(480_000),
      savingsTransfers: cop(0),
      outsideTheApp: cop(0),
    });
    expect(view.consumption.total).toEqual(cop(1_575_000));
    expect(view.otherCurrencySpaces).toEqual([]);
  });

  it("counts transfers into Ana's own SAVINGS accounts, archived ones too, and no other account type (P37, P97)", async () => {
    const { h } = await background();
    const savings = await newAccount(h.ana.personal, "Ahorro programado", 0, "SAVINGS");
    const old = await newAccount(h.ana.personal, "Ahorro viejo", 0, "SAVINGS");
    const investment = await newAccount(h.ana.personal, "Fondo de inversion", 0, "INVESTMENT");
    for (const [destinationAccountId, pesos] of [
      [savings, 200_000],
      [old, 30_000],
      [investment, 50_000],
    ] as const) {
      const transfer = await post(recordTransfer, h.ana.personal, "transfers", {
        description: "Ahorro",
        date: "2026-11-06",
        amount: cop(pesos),
        sourceAccountId: h.ana.account,
        destinationAccountId,
      });
      expect(transfer.status).toBe(201);
    }
    const archived = await call(archiveAccount, "POST", inSpace(h.ana.personal, `accounts/${old}/archive`), {
      user: h.ana.personal,
      params: { spaceId: h.ana.personal.spaceId, accountId: old },
    });
    expect(archived.status).toBe(200);

    const view = await viewOf(h.ana);
    expect(view.cashOut).toEqual({
      total: cop(2_855_000),
      payments: cop(2_145_000),
      fundContributions: cop(480_000),
      savingsTransfers: cop(230_000),
      outsideTheApp: cop(0),
    });
    expect(view.consumption.total).toEqual(cop(1_575_000));
  });

  it("refuses a missing period and a label the caller's personal policy does not name", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await getUnifiedView(ana, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await getUnifiedView(ana, { period: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });

  it("never includes Juan's personal expense in Ana's view, while Juan's own view has it", async () => {
    const { h } = await background();
    await spendAtHome(h.juan, "groceries", 90_000, "2026-11-06");
    const ana = await viewOf(h.ana);
    expect(ana.consumption.total).toEqual(cop(1_575_000));
    // Nor does his 90,000 COP payment reach her cash out: 85,000 + 60,000 + 2,000,000, as in the cash-out test.
    expect(ana.cashOut.payments).toEqual(cop(2_145_000));
    // Juan's 90,000 COP and his shares: 1,200,000 Home, 720,000 Rent and 150,000 market.
    expect((await viewOf(h.juan)).consumption.total).toEqual(cop(2_160_000));
  });

  it("places a shared expense of 2026-11-26 in Ana's 2026-11, while MONTHLY(25) Casa counts it in 2026-12", async () => {
    const ana = await registerUser("Ana");
    const casa = await newSharedSpace(ana, "Casa");
    const policy = await call(updateSpace, "PATCH", `/api/v1/spaces/${casa}`, {
      user: ana,
      params: { spaceId: casa },
      body: { periodPolicy: { kind: "MONTHLY", day: 25 } },
    });
    expect(policy.status).toBe(200);
    const inCasa = actingIn(ana, casa);
    const recorded = await post(recordExpense, inCasa, "expenses", {
      description: "Market",
      date: "2026-11-26",
      categoryId: await categoryWithKey(inCasa, "groceries"),
      amount: cop(100_000),
      accountId: await newAccount(ana, "Bancolombia", 1_000_000),
    });
    expect(recorded.status).toBe(201);
    expect((await viewOf(ana)).consumption.total).toEqual(cop(100_000));
    const dashboard = (await (
      await getLineDashboard(ana, casa, { period: "2026-12" })
    ).json()) as LineDashboardDto;
    expect(dashboard.period).toEqual({ label: "2026-12", startDate: "2026-11-25", endDate: "2026-12-24" });
    expect(dashboard.unbudgeted?.spent).toEqual(cop(100_000));
  });
});

describe("the unified view of a claimed guest place (HU-E1-11)", () => {
  it("includes Pedro's Hotel share recorded while he was a guest, and no share of Trip 2026's own Pedro (@critical)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const hotel = await post(recordExpense, h.ana, "expenses", {
      description: "Hotel",
      date: "2026-10-08",
      categoryId: h.groceries,
      amount: cop(300_000),
      payments: [{ memberId: pedro, accountId: null, amount: cop(300_000) }],
      split: {
        method: "EQUAL",
        participants: [h.ana.memberId, h.juan.memberId, pedro].map((memberId) => ({ memberId })),
      },
    });
    expect(hotel.status).toBe(201);
    const trip = await newSharedSpace(h.ana.personal, "Trip 2026");
    const inTrip = actingIn(h.ana.personal, trip);
    const tripPedro = await addGuest({ ...h, spaceId: trip }, "Pedro");
    const cabin = await post(recordExpense, inTrip, "expenses", {
      description: "Cabin",
      date: "2026-10-09",
      categoryId: await categoryWithKey(inTrip, "travel"),
      amount: cop(200_000),
      payments: [{ memberId: tripPedro, accountId: null, amount: cop(200_000) }],
      split: { method: "EQUAL", participants: [{ memberId: tripPedro }] },
    });
    expect(cabin.status).toBe(201);
    const link = await claimLink(h.ana, h.spaceId, pedro);
    const pedroUser = await registerUser("Pedro");
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${link.token}/accept`, {
      user: pedroUser,
      params: { token: link.token },
    });
    expect(claimed.status).toBe(200);
    const view = await viewOf(pedroUser, "2026-10");
    expect(view.consumption.total).toEqual(cop(100_000));
    expect(view.cashOut).toMatchObject({ payments: cop(300_000), outsideTheApp: cop(300_000) });
  });
});

describe("personal spending by group over HTTP (HU-E7-06)", () => {
  const breakdownOf = async (user: TestUser, period = "2026-11"): Promise<PersonalSpendingByGroupDto> => {
    const response = await getPersonalSpendingByGroup(user, { period });
    expect(response.status).toBe(200);
    return (await response.json()) as PersonalSpendingByGroupDto;
  };

  it("merges seeded groups across Ana's spaces by catalog key and keeps each space's Pets apart (@critical)", async () => {
    const { h } = await background();
    const vetAtHome = await newCategory(h.ana.personal, "Vet", {
      groupId: await newCategoryGroup(h.ana.personal, "Pets"),
    });
    const atHome = await post(recordExpense, h.ana.personal, "expenses", {
      description: "Vet",
      date: "2026-11-08",
      categoryId: vetAtHome,
      amount: cop(40_000),
      accountId: h.ana.account,
    });
    expect(atHome.status).toBe(201);
    // A custom category inside the seeded food group is not merged: it keeps its id and its space (ruling P102).
    const snacks = await newCategory(h.ana.personal, "Snacks", {
      groupId: await groupWithKey(h.ana.personal, "food"),
    });
    const snack = await post(recordExpense, h.ana.personal, "expenses", {
      description: "Snacks",
      date: "2026-11-10",
      categoryId: snacks,
      amount: cop(30_000),
      accountId: h.ana.account,
    });
    expect(snack.status).toBe(201);
    const vet = await newCategory(h.ana, "Vet", { groupId: await newCategoryGroup(h.ana, "Pets") });
    const shared = await post(recordExpense, h.ana, "expenses", {
      description: "Vet",
      date: "2026-11-09",
      categoryId: vet,
      amount: cop(50_000),
      payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(50_000) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    });
    expect(shared.status).toBe(201);
    const breakdown = await breakdownOf(h.ana);
    expect(breakdown.currency).toBe("COP");
    expect(breakdown.total).toEqual(cop(1_670_000));
    expect(
      breakdown.groups.map((g) => [g.key, g.id === null, g.space?.id ?? null, g.total, g.share]),
    ).toEqual([
      ["food", true, null, cop(1_125_000), "67.37"],
      ["housing", true, null, cop(480_000), "28.74"],
      [null, false, h.ana.personal.spaceId, cop(40_000), "2.40"],
      [null, false, h.spaceId, cop(25_000), "1.50"],
    ]);
    // Merged rows are named as Ana's personal space names each key (ruling P76), seeded in Spanish.
    expect(breakdown.groups.slice(0, 2).map((g) => g.name)).toEqual(["Alimentación", "Vivienda"]);
    expect(breakdown.groups[0]!.categories.map((c) => [c.key, c.name])).toEqual([
      ["groceries", "Mercado"],
      ["restaurants", "Restaurantes"],
      [null, "Snacks"],
    ]);
    // The custom Snacks keeps its id and names its space inside the merged food row.
    expect(breakdown.groups[0]!.categories[2]).toMatchObject({
      id: snacks,
      space: { id: h.ana.personal.spaceId, name: "Personal" },
      total: cop(30_000),
    });
    // Each Pets group is one space's own: its category keeps its id and names the space (ruling P102).
    const [petsAtHome, petsShared] = breakdown.groups.slice(2);
    expect(petsAtHome).toMatchObject({
      name: "Pets",
      space: { id: h.ana.personal.spaceId, name: "Personal" },
      categories: [{ id: vetAtHome, name: "Vet", space: { id: h.ana.personal.spaceId, name: "Personal" } }],
    });
    expect(petsShared).toMatchObject({
      name: "Pets",
      space: { id: h.spaceId, name: "Household" },
      categories: [{ id: vet, name: "Vet", space: { id: h.spaceId, name: "Household" } }],
    });
    // Groceries of both spaces is one row under its catalog key.
    expect(breakdown.groups[0]!.categories.filter((c) => c.key === "groceries")).toMatchObject([
      { id: null, space: null, total: cop(1_035_000) },
    ]);
  });

  it("names a subcategory's space, and the entry of the category itself names none (ruling P104)", async () => {
    const { h } = await background();
    const vet = await newCategory(h.ana, "Vet", { groupId: await newCategoryGroup(h.ana, "Pets") });
    const checkup = await newCategory(h.ana, "Checkup", { parentCategoryId: vet });
    for (const [categoryId, pesos] of [
      [vet, 50_000],
      [checkup, 20_000],
    ] as const) {
      const response = await post(recordExpense, h.ana, "expenses", {
        description: "Vet",
        date: "2026-11-09",
        categoryId,
        amount: cop(pesos),
        payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(pesos) }],
        split: {
          method: "EQUAL",
          participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }],
        },
      });
      expect(response.status).toBe(201);
    }
    const breakdown = await breakdownOf(h.ana);
    const pets = breakdown.groups.find((g) => g.name === "Pets")!;
    expect(pets.space).toEqual({ id: h.spaceId, name: "Household" });
    expect(pets.categories).toHaveLength(1);
    expect(pets.categories[0]).toMatchObject({ id: vet, space: { id: h.spaceId, name: "Household" } });
    expect(pets.categories[0]!.subcategories).toEqual([
      { subcategoryId: null, name: null, archived: false, total: cop(25_000), share: "71.43", space: null },
      {
        subcategoryId: checkup,
        name: "Checkup",
        archived: false,
        total: cop(10_000),
        share: "28.57",
        space: { id: h.spaceId, name: "Household" },
      },
    ]);
  });

  it("answers the caller's own rows to a VIEWER, 401 without a session and 422 for a bad period", async () => {
    const { h } = await background();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const viewed = await breakdownOf(sofi);
    expect(viewed.currency).toBe("COP");
    expect(viewed.total).toEqual(cop(0));
    expect(viewed.groups).toEqual([]);
    const anonymous = await call(
      personalSpendingByGroupRoute,
      "GET",
      "/api/v1/me/reports/spending-by-group?period=2026-11",
    );
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    expect(await problemOf(await getPersonalSpendingByGroup(h.ana, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await getPersonalSpendingByGroup(h.ana, { period: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });

  it("counts no income, transfer, settlement or fund contribution as spending, in Ana's breakdown or Household's", async () => {
    const { h } = await background();
    const income = await post(recordIncome, h.ana.personal, "incomes", {
      description: "Salary",
      date: "2026-11-05",
      categoryId: await categoryWithKey(h.ana.personal, "salary"),
      amount: cop(3_000_000),
      accountId: h.ana.account,
    });
    expect(income.status).toBe(201);
    const transfer = await post(recordTransfer, h.ana.personal, "transfers", {
      date: "2026-11-05",
      amount: cop(200_000),
      sourceAccountId: h.ana.account,
      destinationAccountId: await newAccount(h.ana.personal, "Nequi", 0),
    });
    expect(transfer.status).toBe(201);
    const settlement = await post(recordSettlement, h.juan, "settlements", {
      date: "2026-11-30",
      amount: cop(100_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
    });
    expect(settlement.status).toBe(201);
    const mine = await breakdownOf(h.ana);
    expect(mine.total).toEqual(cop(1_575_000));
    expect(mine.total).toEqual((await viewOf(h.ana)).consumption.total);
    // No Income group, and the 480,000 COP fund contribution of 2026-11-01 is in no group.
    expect(mine.groups.map((g) => g.key)).toEqual(["food", "housing"]);
    const response = await getSpendingByGroup(h.ana, h.spaceId, { period: "2026-11" });
    expect(response.status).toBe(200);
    const shared = (await response.json()) as SpendingByGroupDto;
    // The 1,200,000 COP rent paid from Household Fund counts once.
    expect(shared.total).toEqual(cop(3_500_000));
    expect(shared.groups.map((g) => [g.key, g.total, g.share])).toEqual([
      ["food", cop(2_300_000), "65.71"],
      ["housing", cop(1_200_000), "34.29"],
    ]);
  });

  it("never includes Juan's personal expense in Ana's breakdown, while his own has it", async () => {
    const { h } = await background();
    await spendAtHome(h.juan, "groceries", 90_000, "2026-11-06");
    expect((await breakdownOf(h.ana)).total).toEqual(cop(1_575_000));
    // Juan's 90,000 COP and his shares: 1,200,000 Home, 720,000 Rent and 150,000 market.
    expect((await breakdownOf(h.juan)).total).toEqual(cop(2_160_000));
  });

  it("leaves out Ana's expense in a space with another currency, keeping her breakdown in COP", async () => {
    const { h } = await background();
    const created = await call(createSpace, "POST", "/api/v1/spaces", {
      user: h.ana,
      body: { kind: "SHARED", name: "Trip abroad", currency: "USD" },
    });
    expect(created.status).toBe(201);
    const abroadId = ((await created.json()) as { id: string }).id;
    const abroad = actingIn(h.ana.personal, abroadId);
    // The guest pays and splits the dinner with Ana: a bank account lives in a personal space, in its currency.
    const pedro = await addGuest({ ...h, spaceId: abroadId }, "Pedro");
    const dinner = await post(recordExpense, abroad, "expenses", {
      description: "Dinner",
      date: "2026-11-07",
      categoryId: await categoryWithKey(abroad, "restaurants"),
      amount: { amount: "2500", currency: "USD" },
      payments: [{ memberId: pedro, accountId: null, amount: { amount: "2500", currency: "USD" } }],
      split: {
        method: "EQUAL",
        participants: [{ memberId: await memberIdOf(h.ana, abroadId, "Ana") }, { memberId: pedro }],
      },
    });
    expect(dinner.status).toBe(201);
    // The 25.00 USD is spending of its own space ...
    const abroadResponse = await getSpendingByGroup(abroad, abroad.spaceId, { period: "2026-11" });
    expect(abroadResponse.status).toBe(200);
    const inAbroad = (await abroadResponse.json()) as SpendingByGroupDto;
    expect(inAbroad.total).toEqual({ amount: "2500", currency: "USD" });
    // ... and never reaches her COP breakdown, which the unified view mirrors.
    const mine = await breakdownOf(h.ana);
    expect(mine.currency).toBe("COP");
    expect(mine.total).toEqual(cop(1_575_000));
    expect(mine.groups.map((g) => [g.key, g.total.currency])).toEqual([
      ["food", "COP"],
      ["housing", "COP"],
    ]);
    const view = await viewOf(h.ana);
    expect(view.consumption.total).toEqual(cop(1_575_000));
    // Ana does hold a share in the USD space: the unified view lists it as left out.
    expect(view.otherCurrencySpaces).toMatchObject([
      { spaceId: abroadId, name: "Trip abroad", currency: "USD" },
    ]);
  });
});
