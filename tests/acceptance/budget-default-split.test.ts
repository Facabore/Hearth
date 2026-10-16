import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as getTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import {
  activatePlan,
  addLine,
  copyPlan,
  getDefaultSplit,
  lineNamed,
  newPlan,
  patchLine,
  planOf,
  putAllocation,
  putCategories,
  referencePlan,
  setCapacities,
} from "../support/budgeting";
import {
  balancesOf,
  categoryWithKey,
  cop,
  memberIdOf,
  newAccount,
  post,
  type HouseholdMember,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";
import { actingIn } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * HU-E6-08 Background: the reference plan for 2026-11 in Household with Groceries mapped to Home (PROPORTIONAL,
 * Ana 40 % and Juan 60 %) and Free the catch-all line, NONE when `freeIsGroupMoney`; ACTIVE unless `draft`.
 * "Outings" is the seeded entertainment category, mapped to no line.
 */
const activeReference = async (options: { draft?: boolean; freeIsGroupMoney?: boolean } = {}) => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries])).status).toBe(200);
  expect((await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true })).status).toBe(200);
  if (options.freeIsGroupMoney) {
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), { rule: "NONE" })).status).toBe(
      200,
    );
  }
  if (!options.draft) expect((await activatePlan(h.ana, h.spaceId, planId)).status).toBe(200);
  return { ...ref, outings: await categoryWithKey(h.ana, "entertainment") };
};

describe("previewing the default split (HU-E6-08)", () => {
  it("defaults Groceries to BY_ALLOCATION by Home: 800,000 and 1,200,000 COP of 2,000,000 (golden)", async () => {
    const { h, lineId } = await activeReference();
    const response = await getDefaultSplit(h.juan, h.spaceId, {
      categoryId: h.groceries,
      date: "2026-11-08",
      amount: "200000000",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "BY_ALLOCATION",
      availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: lineId("Home"),
      shares: [
        { memberId: h.ana.memberId, amount: cop(800_000) },
        { memberId: h.juan.memberId, amount: cop(1_200_000) },
      ],
    });
  });

  it("gives the remainder of an amount that does not divide to the larger fraction, and the sub-unit to Ana", async () => {
    const { h } = await activeReference();
    // 1,000,001.50 COP over 588,000 / 882,000 COP: 400,000.4 and 600,000.6 pesos, so the leftover peso goes to Juan
    // (the larger fraction) and the 50 minor units below the rounding unit stay with the first member (spec 5.3).
    const response = await getDefaultSplit(h.ana, h.spaceId, {
      categoryId: h.groceries,
      date: "2026-11-08",
      amount: "100000150",
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { shares: unknown }).shares).toEqual([
      { memberId: h.ana.memberId, amount: { amount: "40000050", currency: "COP" } },
      { memberId: h.juan.memberId, amount: { amount: "60000100", currency: "COP" } },
    ]);
  });

  it("defaults an unmapped Outings expense to EQUAL through the NONE catch-all Free, without BY_ALLOCATION", async () => {
    const { h, lineId, outings } = await activeReference({ freeIsGroupMoney: true });
    const response = await getDefaultSplit(h.ana, h.spaceId, {
      categoryId: outings,
      date: "2026-11-12",
      amount: "5000000",
    });
    expect(await response.json()).toEqual({
      method: "EQUAL",
      availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: lineId("Free"),
      shares: [
        { memberId: h.ana.memberId, amount: cop(25_000) },
        { memberId: h.juan.memberId, amount: cop(25_000) },
      ],
    });
  });

  it("defaults to EQUAL while the plan is a DRAFT, and previews no shares without an amount", async () => {
    const { h } = await activeReference({ draft: true });
    const response = await getDefaultSplit(h.ana, h.spaceId, { categoryId: h.groceries, date: "2026-11-08" });
    expect(await response.json()).toMatchObject({ method: "EQUAL", lineId: null, shares: null });
  });

  it("refuses any id that is not a category of the space: another space's, an unknown and a malformed one", async () => {
    const { h } = await activeReference({ draft: true });
    const personal = await categoryWithKey(h.ana.personal, "groceries");
    for (const categoryId of [personal, "7f2b9a54-6c1e-4d3a-8b0f-2e5c9d1a4f63", "not-a-category"]) {
      expect(
        await problemOf(await getDefaultSplit(h.ana, h.spaceId, { categoryId, date: "2026-11-08" })),
      ).toEqual([422, "CategoryNotInSpace"]);
    }
  });

  it("refuses a request without categoryId or date, and a malformed or out-of-range date", async () => {
    const { h } = await activeReference({ draft: true });
    // The helper types both as required; a client that leaves one out is what is under test.
    const ask = (query: { categoryId?: string; date?: string }) =>
      getDefaultSplit(h.ana, h.spaceId, query as Parameters<typeof getDefaultSplit>[2]);
    for (const query of [
      { date: "2026-11-08" },
      { categoryId: h.groceries },
      { categoryId: h.groceries, date: "not-a-date" },
      { categoryId: h.groceries, date: "2026-02-30" },
    ]) {
      expect(await problemOf(await ask(query))).toEqual([422, "ValidationFailed"]);
    }
    expect(await problemOf(await ask({ categoryId: h.groceries, date: "1899-12-31" }))).toEqual([
      422,
      "InvalidDate",
    ]);
  });

  it("accepts only a positive amount in minor units, digits only, within the supported range", async () => {
    const { h } = await activeReference({ draft: true });
    const ask = (amount: string) =>
      getDefaultSplit(h.ana, h.spaceId, { categoryId: h.groceries, date: "2026-11-08", amount });
    // 10^18 is the first value over the 18-digit cap; the other two are beyond int64.
    const overTheCap = ["1000000000000000000", "9223372036854775808", "99999999999999999999"];
    for (const amount of ["0", "-1", "1.5", "abc", "", " 100", "1e3", ...overTheCap]) {
      expect(await problemOf(await ask(amount)), `amount "${amount}"`).toEqual([422, "ValidationFailed"]);
    }
    // The largest accepted amount: 18 nines.
    const largest = await ask("999999999999999999");
    expect(largest.status).toBe(200);
    const { shares } = (await largest.json()) as { shares: { amount: { amount: string } }[] };
    expect(shares.reduce((sum, s) => sum + BigInt(s.amount.amount), 0n)).toBe(999_999_999_999_999_999n);
  });

  it("hides the space from non-members and from a malformed space id", async () => {
    const { h } = await activeReference({ draft: true });
    const marta = await registerUser("Marta");
    const query = { categoryId: h.groceries, date: "2026-11-08" };
    expect(await problemOf(await getDefaultSplit(marta, h.spaceId, query))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await getDefaultSplit(h.ana, "not-a-space", query))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("previews in an archived space too, which only reads (HU-E1-09)", async () => {
    const { h } = await activeReference({ draft: true });
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const response = await getDefaultSplit(h.juan, h.spaceId, {
      categoryId: h.groceries,
      date: "2026-11-08",
    });
    expect(response.status).toBe(200);
  });
});

/** `payer` pays `amount` (whole pesos, or exact money) on `date` in `categoryId` from their own account, with `split` when given. */
const pays = async (
  payer: HouseholdMember,
  categoryId: string,
  amount: number | MoneyDto,
  date: string,
  split?: unknown,
): Promise<TransactionDto> => {
  const response = await post(recordExpense, payer, "expenses", {
    description: "Market",
    date,
    categoryId,
    amount: typeof amount === "number" ? cop(amount) : amount,
    accountId: payer.account,
    ...(split === undefined ? {} : { split }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionDto;
};
const sharesOf = (tx: TransactionDto) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

describe("expenses default to their line's allocation (HU-E6-08, D4)", () => {
  it("splits Ana's 2,000,000 COP Groceries expense 800,000 / 1,200,000 BY_ALLOCATION: Juan owes Ana 1,200,000 COP (@critical, golden)", async () => {
    const { h } = await activeReference();
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
    const tx = await pays(h.ana, h.groceries, 2_000_000, "2026-11-08");
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(800_000), "BY_ALLOCATION"],
      [h.juan.memberId, cop(1_200_000), "BY_ALLOCATION"],
    ]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(1_200_000)],
      [h.juan.memberId, cop(-1_200_000)],
    ]);
  });

  it("records exactly the shares the preview shows for 1,000,001.50 COP, which does not divide 40 % / 60 %", async () => {
    const { h } = await activeReference();
    const amount = { amount: "100000150", currency: "COP" };
    const preview = await getDefaultSplit(h.juan, h.spaceId, {
      categoryId: h.groceries,
      date: "2026-11-08",
      amount: amount.amount,
    });
    const { shares } = (await preview.json()) as { shares: { memberId: string; amount: MoneyDto }[] };
    const tx = await pays(h.ana, h.groceries, amount, "2026-11-08");
    // Member by member and in order; the leftover peso goes to Juan, the 50 minor units below the unit to Ana.
    expect(sharesOf(tx)).toEqual(shares.map((s) => [s.memberId, s.amount, "BY_ALLOCATION"]));
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, { amount: "40000050", currency: "COP" }, "BY_ALLOCATION"],
      [h.juan.memberId, { amount: "60000100", currency: "COP" }, "BY_ALLOCATION"],
    ]);
  });

  it("keeps the split a member chooses: EQUAL gives 1,000,000 COP each", async () => {
    const { h } = await activeReference();
    const equal = {
      method: "EQUAL",
      participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }],
    };
    expect(sharesOf(await pays(h.ana, h.groceries, 2_000_000, "2026-11-08", equal))).toEqual([
      [h.ana.memberId, cop(1_000_000), "EQUAL"],
      [h.juan.memberId, cop(1_000_000), "EQUAL"],
    ]);
  });

  it("splits by fixed amounts: Home FIXED 490,000 / 980,000 COP shares Juan's 300,000 COP as 100,000 / 200,000", async () => {
    const { h, planId, lineId } = await activeReference();
    const fixed = {
      rule: "FIXED",
      members: [
        { memberId: h.ana.memberId, amount: cop(490_000) },
        { memberId: h.juan.memberId, amount: cop(980_000) },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Home"), fixed)).status).toBe(200);
    expect(sharesOf(await pays(h.juan, h.groceries, 300_000, "2026-11-10"))).toEqual([
      [h.ana.memberId, cop(100_000), "BY_ALLOCATION"],
      [h.juan.memberId, cop(200_000), "BY_ALLOCATION"],
    ]);
  });

  it("keeps recorded shares as a snapshot when Home is allocated 50 % / 50 % afterwards", async () => {
    const { h, planId, lineId } = await activeReference();
    const tx = await pays(h.ana, h.groceries, 2_000_000, "2026-11-08");
    expect(sharesOf(tx).map((share) => share[2])).toEqual(["BY_ALLOCATION", "BY_ALLOCATION"]);
    const half = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "50" },
        { memberId: h.juan.memberId, percent: "50" },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Home"), half)).status).toBe(200);
    const read = await call(getTransaction, "GET", `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: tx.id },
    });
    expect(sharesOf((await read.json()) as TransactionDto)).toEqual(sharesOf(tx));
  });

  it("defaults an unmapped Outings expense to EQUAL through the NONE catch-all Free, which it consumes", async () => {
    const { h, planId, outings } = await activeReference({ freeIsGroupMoney: true });
    expect(sharesOf(await pays(h.ana, outings, 50_000, "2026-11-12"))).toEqual([
      [h.ana.memberId, cop(25_000), "EQUAL"],
      [h.juan.memberId, cop(25_000), "EQUAL"],
    ]);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Free").spent).toEqual(cop(50_000));
  });

  it("defaults to EQUAL in a DRAFT plan: the 2026-12 copy does not drive splits", async () => {
    const { h } = await activeReference();
    expect((await copyPlan(h.ana, h.spaceId, "2026-12")).status).toBe(201);
    expect(sharesOf(await pays(h.ana, h.groceries, 100_000, "2026-12-05"))).toEqual([
      [h.ana.memberId, cop(50_000), "EQUAL"],
      [h.juan.memberId, cop(50_000), "EQUAL"],
    ]);
  });

  it("applies the same default in a DIRECT space once its plan is ACTIVE: a later split with Pedro follows the line (HU-E1-13)", async () => {
    const ana = await registerUser("Ana");
    const bancolombia = await newAccount(ana, "Bancolombia", 2_000_000);
    const splitWithPedro = async (counterpart: unknown, pesos: number) => {
      const response = await call(directSplit, "POST", "/api/v1/direct-splits", {
        user: ana,
        body: {
          counterpart,
          description: "Dinner",
          date: "2026-10-14",
          categoryKey: "restaurants",
          amount: cop(pesos),
          accountId: bancolombia,
        },
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { spaceId: string; expense: TransactionDto };
    };
    // A new direct space has no plan, so its first split stays EQUAL.
    const first = await splitWithPedro({ kind: "GUEST", displayName: "Pedro" }, 120_000);
    const { spaceId } = first;
    const anaId = await memberIdOf(ana, spaceId, "Ana");
    const pedroId = await memberIdOf(ana, spaceId, "Pedro");
    expect(sharesOf(first.expense)).toEqual([
      [anaId, cop(60_000), "EQUAL"],
      [pedroId, cop(60_000), "EQUAL"],
    ]);
    // The space is Ana's to plan (OWNER, plan.manage): Dining takes the restaurants category, FIXED 100,000 / 200,000.
    const restaurants = await categoryWithKey(actingIn(ana, spaceId), "restaurants");
    const { id: planId } = await newPlan(ana, spaceId, "2026-10");
    await setCapacities(ana, spaceId, planId, [
      [anaId, 1_000_000],
      [pedroId, 1_000_000],
    ]);
    const plan = await addLine(ana, spaceId, planId, {
      name: "Dining",
      pesos: 300_000,
      funding: "DIRECT",
      rolloverMode: "RESET",
    });
    const diningId = lineNamed(plan, "Dining").id;
    expect((await putCategories(ana, spaceId, planId, diningId, [restaurants])).status).toBe(200);
    const fixed = {
      rule: "FIXED",
      members: [
        { memberId: anaId, amount: cop(100_000) },
        { memberId: pedroId, amount: cop(200_000) },
      ],
    };
    expect((await putAllocation(ana, spaceId, planId, diningId, fixed)).status).toBe(200);
    expect((await activatePlan(ana, spaceId, planId)).status).toBe(200);
    const taxi = await splitWithPedro({ kind: "MEMBER", memberId: pedroId }, 300_000);
    expect(taxi.spaceId).toBe(spaceId);
    expect(sharesOf(taxi.expense)).toEqual([
      [anaId, cop(100_000), "BY_ALLOCATION"],
      [pedroId, cop(200_000), "BY_ALLOCATION"],
    ]);
    // Ana paid 420,000 COP and owes 60,000 + 100,000 COP: Pedro owes her 260,000 COP.
    expect(await balancesOf(ana, spaceId)).toEqual([
      [anaId, cop(260_000)],
      [pedroId, cop(-260_000)],
    ]);
  });
});
