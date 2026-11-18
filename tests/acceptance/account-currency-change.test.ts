import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as getAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import {
  GET as previewCurrency,
  PUT as changeCurrency,
} from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/currency/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { GET as getTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, startTestApp, type TestUser } from "../support/app";
import {
  categoryWithKey,
  cop,
  household,
  inSpace,
  post,
  type MoneyDto,
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

/** Whole dollars on the wire: USD has two minor digits, like COP. */
const usd = (dollars: number): MoneyDto => ({ amount: String(dollars * 100), currency: "USD" });
/** 2036-05-20, a day no other test stores a rate for, so the expense's leg is known: US$ 1 = $ 4.000. */
const RATE_DAY = "2036-05-20";

const created = async (response: Promise<Response>) => {
  const answer = await response;
  expect(answer.status).toBe(201);
  return (await answer.json()) as { id: string } & TransactionDto;
};

/**
 * Ana's personal "Cuenta en dólares" opens with US$ 120; she receives US$ 100 into it (kept in USD, P342), and pays
 * the household's $ 300.000 market from it, split with Juan (US$ 75 at the day's rate).
 */
const dollarsWorld = async () => {
  await app.pool.query(
    `INSERT INTO exchange_rates (date, base, quote, rate, source, fetched_at)
     VALUES ($1, 'USD', 'COP', '4000', 'test', now()) ON CONFLICT DO NOTHING`,
    [RATE_DAY],
  );
  const h = await household();
  const ana = h.ana.personal;
  const dollars = await created(
    post(createAccount, ana, "accounts", {
      name: "Cuenta en dólares",
      type: "BANK",
      currency: "USD",
      openingBalance: usd(120),
    }),
  );
  const income = await created(
    post(recordIncome, ana, "incomes", {
      description: "Freelance",
      amount: usd(100),
      date: RATE_DAY,
      categoryId: await categoryWithKey(ana, "salary"),
      accountId: dollars.id,
    }),
  );
  const market = await created(
    post(recordExpense, h.ana, "expenses", {
      description: "Mercado",
      date: RATE_DAY,
      categoryId: h.groceries,
      amount: cop(300_000),
      payments: [{ memberId: h.ana.memberId, accountId: dollars.id, amount: cop(300_000) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    }),
  );
  return { h, ana, dollars: dollars.id, income: income.id, market: market.id };
};

const preview = (user: TestUser, accountId: string, query: string) =>
  call(previewCurrency, "GET", inSpace(user, `accounts/${accountId}/currency?${query}`), {
    user,
    params: { spaceId: user.spaceId, accountId },
  });
const change = (user: TestUser, accountId: string, body: unknown) =>
  call(changeCurrency, "PUT", inSpace(user, `accounts/${accountId}/currency`), {
    user,
    params: { spaceId: user.spaceId, accountId },
    body,
  });
const transaction = async (user: TestUser, transactionId: string) => {
  const response = await call(getTransaction, "GET", inSpace(user, `transactions/${transactionId}`), {
    user,
    params: { spaceId: user.spaceId, transactionId },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as TransactionDto;
};
const auditCount = async (transactionId: string) =>
  (
    await app.pool.query("SELECT count(*)::int AS n FROM transaction_audit WHERE transaction_id = $1", [
      transactionId,
    ])
  ).rows[0].n as number;

describe("changing an account's currency (P336)", () => {
  it("previews the change at the rate typed: the movements that convert and the balance before and after", async () => {
    const w = await dollarsWorld();
    const response = await preview(w.ana, w.dollars, "currency=COP&rate=4100");
    expect(response.status).toBe(200);
    // US$ 120 + US$ 100 − US$ 75 = US$ 145; at 4.100: $ 492.000 + $ 410.000 − $ 307.500 = $ 594.500.
    expect(await response.json()).toEqual({
      from: "USD",
      to: "COP",
      rate: "4100",
      rateDate: null,
      movements: 2,
      balanceBefore: usd(145),
      balanceAfter: cop(594_500),
    });
  });

  it("offers no rate when none is stored between the currencies, and still counts the movements", async () => {
    const w = await dollarsWorld();
    const response = await preview(w.ana, w.dollars, "currency=MNT");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rate: null,
      rateDate: null,
      movements: 2,
      balanceAfter: null,
    });
  });

  it("converts the account and what each movement moved it by, keeping the household's amounts and shares (@critical)", async () => {
    const w = await dollarsWorld();
    const response = await change(w.ana, w.dollars, { currency: "COP", rate: "4100" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      openingBalance: cop(492_000),
      balance: cop(594_500),
    });
    // P342 (S3): her own income keeps its US$ 100; what the account received, at the rate, becomes its COP leg.
    const income = await transaction(w.ana, w.income);
    expect(income.amount).toEqual(usd(100));
    expect(income.destinationAmount).toEqual(cop(410_000));
    expect(income.originalAmount).toBeUndefined();
    // The household's market keeps its $ 300.000 and its halves; only what her account paid converts.
    const market = await transaction(w.h.ana, w.market);
    expect(market.amount).toEqual(cop(300_000));
    expect(market.shares.map((s) => s.amount)).toEqual([cop(150_000), cop(150_000)]);
    expect(market.payments[0]).toMatchObject({ amount: cop(300_000), accountAmount: cop(307_500) });
    // D8: each changed movement keeps its audit.
    expect([await auditCount(w.income), await auditCount(w.market)]).toEqual([1, 1]);
    const account = await call(getAccount, "GET", inSpace(w.ana, `accounts/${w.dollars}`), {
      user: w.ana,
      params: { spaceId: w.ana.spaceId, accountId: w.dollars },
    });
    expect(((await account.json()) as { balance: MoneyDto }).balance).toEqual(cop(594_500));
  });

  it("with a rate of 1 keeps the figures and only changes their currency", async () => {
    const w = await dollarsWorld();
    const response = await change(w.ana, w.dollars, { currency: "COP", rate: "1" });
    expect(response.status).toBe(200);
    // US$ 145,00 becomes $ 145,00.
    expect(await response.json()).toMatchObject({ openingBalance: cop(120), balance: cop(145) });
  });

  it("answers refusals with stable codes and changes nothing", async () => {
    const w = await dollarsWorld();
    const cases: [TestUser, unknown, number, string][] = [
      [w.ana, { currency: "USD", rate: "1" }, 409, "CurrencyUnchanged"],
      [w.ana, { currency: "COP", rate: "0" }, 422, "InvalidExchangeRate"],
      [w.ana, { currency: "COP", rate: "4.100,50" }, 422, "InvalidExchangeRate"],
      [w.ana, { currency: "XYZ", rate: "1" }, 422, "UnknownCurrency"],
      [w.ana, { currency: "COP", rate: "0.0000001" }, 422, "ConvertedAmountTooSmall"],
      [
        { ...w.h.juan.personal, spaceId: w.ana.spaceId },
        { currency: "COP", rate: "1" },
        404,
        "SpaceNotFound",
      ],
    ];
    for (const [user, body, status, code] of cases) {
      const response = await change(user, w.dollars, body);
      expect([response.status, ((await response.json()) as { code: string }).code]).toEqual([status, code]);
    }
    // P342: the USD income into the USD account is unchanged: in USD, with no leg.
    const income = await transaction(w.ana, w.income);
    expect(income.amount).toEqual(usd(100));
    expect(income.destinationAmount).toBeUndefined();
  });
});
