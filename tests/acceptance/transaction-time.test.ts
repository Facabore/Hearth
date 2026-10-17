import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { PATCH as patchMe } from "@/app/api/v1/me/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordFundContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, household, newAccount, post, type TransactionDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  // HU-E4-14 Background: the Clock reads 2026-10-17T03:30:00Z.
  app = startTestApp({ clock: new FixedClock(new Date("2026-10-17T03:30:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const setZone = (user: TestUser, timezone: string) =>
  call(patchMe, "PATCH", "/api/v1/me", { user, body: { timezone } });
/** Ana (Bogotá by APP_TIMEZONE) with "Bancolombia" in her personal space. */
const ana = async () => {
  const user = await registerUser("Ana");
  return {
    user,
    bank: await newAccount(user, "Bancolombia", 2_000_000),
    restaurants: await categoryWithKey(user, "restaurants"),
  };
};
type Ana = Awaited<ReturnType<typeof ana>>;
const expense = (a: Ana, extra: Record<string, unknown>) =>
  post(recordExpense, a.user, "expenses", {
    description: "Coffee",
    categoryId: a.restaurants,
    amount: cop(12_000),
    accountId: a.bank,
    ...extra,
  });
const timeOf = async (response: Response) => {
  expect(response.status).toBe(201);
  const tx = (await response.json()) as TransactionDto;
  return [tx.date, tx.occurredAt, tx.timeZone];
};

describe("recording the time of a transaction (HU-E4-14)", () => {
  it("records an expense with the time it happened (@critical)", async () => {
    const a = await ana();
    expect(await timeOf(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00" }))).toEqual([
      "2026-10-16",
      "2026-10-16T19:32:00.000Z",
      "America/Bogota",
    ]);
  });

  it("takes the moment of recording in each user's zone without a date or a time", async () => {
    const a = await ana();
    const juan = await ana();
    expect((await setZone(juan.user, "Europe/Madrid")).status).toBe(200);
    expect(await timeOf(await expense(a, {}))).toEqual([
      "2026-10-16",
      "2026-10-17T03:30:00.000Z",
      "America/Bogota",
    ]);
    expect(await timeOf(await expense(juan, {}))).toEqual([
      "2026-10-17",
      "2026-10-17T03:30:00.000Z",
      "Europe/Madrid",
    ]);
  });

  it("gives a date alone the time of day of now, and refuses a disagreeing pair, a null time or an unknown zone", async () => {
    const a = await ana();
    expect(await timeOf(await expense(a, { date: "2026-10-15" }))).toEqual([
      "2026-10-15",
      "2026-10-16T03:30:00.000Z",
      "America/Bogota",
    ]);
    // No body can ask for a date with no time: `untimed` is for system paths, and the body drops it.
    expect(await timeOf(await expense(a, { date: "2026-10-15", untimed: true }))).toEqual([
      "2026-10-15",
      "2026-10-16T03:30:00.000Z",
      "America/Bogota",
    ]);
    expect(
      await problemOf(await expense(a, { date: "2026-10-15", occurredAt: "2026-10-16T14:32:00-05:00" })),
    ).toEqual([422, "DateTimeMismatch"]);
    expect(await problemOf(await expense(a, { occurredAt: null }))).toEqual([422, "TimeRequired"]);
    expect(await problemOf(await expense(a, { timeZone: "Bogota" }))).toEqual([422, "InvalidTimeZone"]);
  });

  it("takes a time on incomes, transfers, fund contributions and settlements", async () => {
    const a = await ana();
    const occurredAt = "2026-10-16T14:32:00-05:00";
    const salary = await categoryWithKey(a.user, "salary");
    const wallet = await newAccount(a.user, "Nequi", 0);
    const income = await post(recordIncome, a.user, "incomes", {
      categoryId: salary,
      amount: cop(100_000),
      accountId: a.bank,
      occurredAt,
    });
    // 20:30 in Bogotá is 03:30 the next day in Madrid: the date follows the zone that was sent.
    const transfer = await post(recordTransfer, a.user, "transfers", {
      amount: cop(50_000),
      sourceAccountId: a.bank,
      destinationAccountId: wallet,
      occurredAt: "2026-10-16T20:30:00-05:00",
      timeZone: "Europe/Madrid",
    });
    expect(await timeOf(income)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
    expect(await timeOf(transfer)).toEqual(["2026-10-17", "2026-10-17T01:30:00.000Z", "Europe/Madrid"]);
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
    const contribution = await post(recordFundContribution, h.ana, "fund-contributions", {
      amount: cop(100_000),
      fundAccountId: fund,
      sourceAccountId: h.ana.account,
      occurredAt,
    });
    const settlement = await post(recordSettlement, h.juan, "settlements", {
      amount: cop(10_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      occurredAt,
    });
    expect(await timeOf(contribution)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
    expect(await timeOf(settlement)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
  });

  it("takes a time on a direct split", async () => {
    const a = await ana();
    const response = await call(directSplit, "POST", "/api/v1/direct-splits", {
      user: a.user,
      body: {
        counterpart: { kind: "GUEST", displayName: "Pedro" },
        categoryKey: "restaurants",
        amount: cop(12_000),
        accountId: a.bank,
        occurredAt: "2026-10-16T20:30:00-05:00",
        timeZone: "Europe/Madrid",
      },
    });
    expect(response.status).toBe(201);
    const { expense } = (await response.json()) as { expense: TransactionDto };
    expect([expense.date, expense.occurredAt, expense.timeZone]).toEqual([
      "2026-10-17",
      "2026-10-17T01:30:00.000Z",
      "Europe/Madrid",
    ]);
  });

  it("refuses an instant whose local date is outside the supported years, like a bad date (InvalidDate)", async () => {
    const a = await ana();
    expect(await problemOf(await expense(a, { occurredAt: "0026-10-16T14:32:00Z" }))).toEqual([
      422,
      "InvalidDate",
    ]);
    expect(await problemOf(await expense(a, { date: "0026-10-16" }))).toEqual([422, "InvalidDate"]);
  });
});

/** One valid request per create endpoint, to which a test adds its time fields. */
const creations: [string, (extra: Record<string, unknown>) => Promise<Response>][] = [
  ["expense", async (extra) => expense(await ana(), extra)],
  [
    "income",
    async (extra) => {
      const a = await ana();
      const body = {
        categoryId: await categoryWithKey(a.user, "salary"),
        amount: cop(100_000),
        accountId: a.bank,
      };
      return post(recordIncome, a.user, "incomes", { ...body, ...extra });
    },
  ],
  [
    "transfer",
    async (extra) => {
      const a = await ana();
      const body = {
        amount: cop(50_000),
        sourceAccountId: a.bank,
        destinationAccountId: await newAccount(a.user, "Nequi", 0),
      };
      return post(recordTransfer, a.user, "transfers", { ...body, ...extra });
    },
  ],
  [
    "fund contribution",
    async (extra) => {
      const h = await household();
      const fundAccountId = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
      const body = { amount: cop(100_000), fundAccountId, sourceAccountId: h.ana.account };
      return post(recordFundContribution, h.ana, "fund-contributions", { ...body, ...extra });
    },
  ],
  [
    "settlement",
    async (extra) => {
      const h = await household();
      const body = { amount: cop(10_000), payerMemberId: h.juan.memberId, receivingMemberId: h.ana.memberId };
      return post(recordSettlement, h.juan, "settlements", { ...body, ...extra });
    },
  ],
  [
    "direct split",
    async (extra) => {
      const a = await ana();
      const body = {
        counterpart: { kind: "GUEST", displayName: "Pedro" },
        categoryKey: "restaurants",
        amount: cop(12_000),
        accountId: a.bank,
      };
      return call(directSplit, "POST", "/api/v1/direct-splits", {
        user: a.user,
        body: { ...body, ...extra },
      });
    },
  ],
];

describe("a time that is removed or does not fit, on every create endpoint (HU-E4-14)", () => {
  it.each(creations)("refuses a null time on the %s endpoint (TimeRequired)", async (_, create) => {
    expect(await problemOf(await create({ date: "2026-10-16", occurredAt: null }))).toEqual([
      422,
      "TimeRequired",
    ]);
  });
});
