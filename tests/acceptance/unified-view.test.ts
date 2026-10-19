import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
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
  newAccount,
  post,
  type HouseholdMember,
} from "../support/ledger";
import {
  contribute,
  getLineDashboard,
  getUnifiedView,
  reportHousehold,
  spend,
  type LineDashboardDto,
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
