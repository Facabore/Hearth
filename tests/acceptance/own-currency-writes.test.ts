import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSettlement } from "@/app/api/v1/direct-settlements/route";
import { GET as exchangeRate } from "@/app/api/v1/exchange-rates/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { PATCH as editTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { ExchangeRate, Money } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  balanceOf,
  categoryWithKey,
  cop,
  household,
  inSpace,
  newAccount,
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
const eur = (euros: number): MoneyDto => ({ amount: String(euros * 100), currency: "EUR" });

/**
 * 2035-07-01, past every other test's rate day, so the 4.100 COP per dollar it stores is the latest rate only from that
 * day on. 2026-10-05 has no USD rate at all.
 */
const RATE_DAY = "2035-07-01";
const NO_RATE_DAY = "2026-10-05";
const storeRate = () =>
  app.pool.query(
    `INSERT INTO exchange_rates (date, base, quote, rate, source, fetched_at)
     VALUES ($1, 'USD', 'COP', '4100', 'test', now()) ON CONFLICT DO NOTHING`,
    [RATE_DAY],
  );

interface Person extends TestUser {
  /** A COP account opened with 2.000.000 COP. */
  readonly bank: string;
  readonly groceries: string;
  readonly salary: string;
}
const person = async (): Promise<Person> => {
  await storeRate();
  const user = await registerUser("Ana");
  return {
    ...user,
    bank: await newAccount(user, "Bancolombia", 2_000_000),
    groceries: await categoryWithKey(user, "groceries"),
    salary: await categoryWithKey(user, "salary"),
  };
};

const recorded = async (response: Promise<Response>): Promise<TransactionDto> => {
  const answer = await response;
  expect(answer.status).toBe(201);
  return (await answer.json()) as TransactionDto;
};
const dollarsMarket = (ana: Person, extra: Record<string, unknown> = {}, date = RATE_DAY) => ({
  description: "Market in USD",
  amount: usd(100),
  date,
  categoryId: ana.groceries,
  accountId: ana.bank,
  ...extra,
});
const edit = (user: TestUser, transactionId: string, body: unknown) =>
  call(editTransaction, "PATCH", inSpace(user, `transactions/${transactionId}`), {
    user,
    params: { spaceId: user.spaceId, transactionId },
    body,
  });

describe("an expense or income in any currency, with an explicit account leg (P342, S3)", () => {
  it("stores a USD expense in a COP space in USD, with what the COP account paid as its leg", async () => {
    const ana = await person();
    const body = await recorded(
      post(recordExpense, ana, "expenses", dollarsMarket(ana, { accountAmount: cop(405_000) })),
    );
    expect(body.amount).toEqual(usd(100));
    expect(body.originalAmount).toBeUndefined();
    expect(body.payments).toEqual([
      { memberId: expect.any(String), accountId: ana.bank, amount: usd(100), accountAmount: cop(405_000) },
    ]);
    expect(body.shares.map((s) => s.amount)).toEqual([usd(100)]);
    expect(await balanceOf(ana, ana.bank)).toEqual(cop(1_595_000));
  });

  it("suggests the account leg from the day's rate when none is sent", async () => {
    const ana = await person();
    const body = await recorded(post(recordExpense, ana, "expenses", dollarsMarket(ana)));
    expect(body.payments[0]).toMatchObject({ amount: usd(100), accountAmount: cop(410_000) });
    expect(await balanceOf(ana, ana.bank)).toEqual(cop(1_590_000));
  });

  it("answers 422 ExchangeRateRequired with no rate that day and no account leg", async () => {
    const ana = await person();
    const response = await post(recordExpense, ana, "expenses", dollarsMarket(ana, {}, NO_RATE_DAY));
    expect(await problemOf(response)).toEqual([422, "ExchangeRateRequired"]);
  });

  it("takes the deprecated convertedAmount as the account leg, and refuses one in another currency", async () => {
    const ana = await person();
    const body = await recorded(
      post(
        recordExpense,
        ana,
        "expenses",
        dollarsMarket(ana, { convertedAmount: cop(408_000) }, NO_RATE_DAY),
      ),
    );
    expect(body.amount).toEqual(usd(100));
    expect(body.payments[0]).toMatchObject({ amount: usd(100), accountAmount: cop(408_000) });
    const wrong = await post(
      recordExpense,
      ana,
      "expenses",
      dollarsMarket(ana, { convertedAmount: eur(90) }),
    );
    expect(await problemOf(wrong)).toEqual([422, "CurrencyMismatch"]);
  });

  it("refuses an account leg that is not in the account's currency", async () => {
    const ana = await person();
    const response = await post(
      recordExpense,
      ana,
      "expenses",
      dollarsMarket(ana, { accountAmount: eur(90) }),
    );
    expect(await problemOf(response)).toEqual([422, "CurrencyMismatch"]);
  });

  it("takes a payment's own account leg", async () => {
    const ana = await person();
    const own = await recorded(post(recordExpense, ana, "expenses", dollarsMarket(ana)));
    const memberId = own.payments[0]!.memberId;
    const body = await recorded(
      post(recordExpense, ana, "expenses", {
        ...dollarsMarket(ana),
        accountId: undefined,
        payments: [{ memberId, accountId: ana.bank, amount: usd(100), accountAmount: cop(402_000) }],
      }),
    );
    expect(body.payments[0]).toMatchObject({ amount: usd(100), accountAmount: cop(402_000) });
  });

  it("stores a USD income in USD with what the COP account received, also through convertedAmount", async () => {
    const ana = await person();
    const income = (extra: Record<string, unknown>) =>
      recorded(
        post(recordIncome, ana, "incomes", {
          description: "Freelance in USD",
          amount: usd(100),
          date: RATE_DAY,
          categoryId: ana.salary,
          accountId: ana.bank,
          ...extra,
        }),
      );
    const typed = await income({ accountAmount: cop(405_000) });
    expect(typed).toMatchObject({ amount: usd(100), destinationAmount: cop(405_000) });
    expect(typed.originalAmount).toBeUndefined();
    const aliased = await income({ convertedAmount: cop(400_000) });
    expect(aliased).toMatchObject({ amount: usd(100), destinationAmount: cop(400_000) });
    expect(await balanceOf(ana, ana.bank)).toEqual(cop(2_805_000));
  });

  it("edits the account leg, through accountAmount or the deprecated convertedAmount", async () => {
    const ana = await person();
    const tx = await recorded(post(recordExpense, ana, "expenses", dollarsMarket(ana)));
    const typed = await edit(ana, tx.id, { accountAmount: cop(420_000) });
    expect(typed.status).toBe(200);
    expect(((await typed.json()) as TransactionDto).payments[0]).toMatchObject({
      amount: usd(100),
      accountAmount: cop(420_000),
    });
    const aliased = await edit(ana, tx.id, { convertedAmount: cop(415_000) });
    expect(aliased.status).toBe(200);
    const body = (await aliased.json()) as TransactionDto;
    expect(body.amount).toEqual(usd(100));
    expect(body.originalAmount).toBeUndefined();
    expect(body.payments[0]).toMatchObject({ amount: usd(100), accountAmount: cop(415_000) });
    expect(await balanceOf(ana, ana.bank)).toEqual(cop(1_585_000));
  });

  it("records a single-currency expense exactly as before, ignoring a convertedAmount in its own currency", async () => {
    const ana = await person();
    const body = await recorded(
      post(recordExpense, ana, "expenses", {
        description: "Market",
        amount: cop(85_000),
        convertedAmount: cop(90_000),
        date: "2026-10-05",
        categoryId: ana.groceries,
        accountId: ana.bank,
      }),
    );
    expect(body.amount).toEqual(cop(85_000));
    expect(body.payments).toEqual([
      { memberId: expect.any(String), accountId: ana.bank, amount: cop(85_000) },
    ]);
    expect(body.originalAmount).toBeUndefined();
    expect(await balanceOf(ana, ana.bank)).toEqual(cop(1_915_000));
  });
});

describe("settling in another currency is an explicit exchange (P342, S5)", () => {
  it("settles 50 USD with 204.000 COP received into the recorder's COP account, not the day's 205.000", async () => {
    await storeRate();
    const h = await household();
    const body = await recorded(
      post(recordSettlement, h.ana, "settlements", {
        date: RATE_DAY,
        amount: usd(50),
        payerMemberId: h.juan.memberId,
        receivingMemberId: h.ana.memberId,
        destinationAccountId: h.ana.account,
        destinationAmount: cop(204_000),
      }),
    );
    expect(body).toMatchObject({ type: "SETTLEMENT", amount: usd(50), destinationAmount: cop(204_000) });
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(2_204_000));
  });

  it("answers 422 ExchangeAccountRequired for a leg in COP with no account of the recorder's in COP", async () => {
    await storeRate();
    const h = await household();
    const response = await post(recordSettlement, h.ana, "settlements", {
      date: RATE_DAY,
      amount: usd(50),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      destinationAmount: cop(205_000),
    });
    expect(await problemOf(response)).toEqual([422, "ExchangeAccountRequired"]);
  });

  it("sends 50 USD to someone from a COP account with what the account moved (P334)", async () => {
    await storeRate();
    const h = await household();
    const response = await call(directSettlement, "POST", "/api/v1/direct-settlements", {
      user: h.ana,
      body: {
        counterpart: { kind: "MEMBER", memberId: h.juan.memberId },
        direction: "TO",
        date: RATE_DAY,
        amount: usd(50),
        accountId: h.ana.account,
        accountAmount: cop(206_000),
      },
    });
    expect(response.status).toBe(201);
    const { settlement } = (await response.json()) as { settlement: TransactionDto };
    expect(settlement).toMatchObject({ amount: usd(50), sourceAmount: cop(206_000) });
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_794_000));
  });
});

describe("the day's exchange rate, to suggest an account leg (P342)", () => {
  const rateOf = (user: TestUser | undefined, query: string) =>
    call(exchangeRate, "GET", `/api/v1/exchange-rates?${query}`, user === undefined ? {} : { user });

  it("answers the rate of the day asked for, and the day of the rate it rests on", async () => {
    const ana = await person();
    const same = await rateOf(ana, `base=USD&quote=COP&on=${RATE_DAY}`);
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ rate: "4100", on: RATE_DAY });
    const later = await rateOf(ana, "base=USD&quote=COP&on=2035-07-04");
    expect(await later.json()).toEqual({ rate: "4100", on: RATE_DAY });
  });

  it("answers 404 ExchangeRateNotFound without a rate, and refuses bad queries and anonymous callers", async () => {
    const ana = await person();
    expect(await problemOf(await rateOf(ana, "base=USD&quote=COP&on=2000-01-03"))).toEqual([
      404,
      "ExchangeRateNotFound",
    ]);
    expect(await problemOf(await rateOf(ana, `base=USD&quote=USD&on=${RATE_DAY}`))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await rateOf(ana, `base=XYZ&quote=COP&on=${RATE_DAY}`))).toEqual([
      422,
      "UnknownCurrency",
    ]);
    expect(await problemOf(await rateOf(ana, "base=USD&quote=COP&on=2035-02-30"))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await rateOf(undefined, `base=USD&quote=COP&on=${RATE_DAY}`))).toEqual([
      401,
      "Unauthenticated",
    ]);
  });

  /** What the kernel's own conversion gives `minor` of `base` at the answered rate: the figure `converted` must be. */
  const convertedByMoney = (minor: bigint, base: string, quote: string, rate: string): MoneyDto => {
    const money = Money.ofMinor(minor, base);
    const exchange = ExchangeRate.of(base, quote, rate);
    if (!money.ok || !exchange.ok) throw new Error("bad fixture");
    const converted = money.value.convert(exchange.value);
    if (!converted.ok) throw new Error("bad fixture");
    return { amount: converted.value.minor.toString(), currency: converted.value.currency.code };
  };

  it("converts an amount with Money's own conversion: 50,00 USD at 4.100 is 205.000 COP", async () => {
    const ana = await person();
    const answer = await rateOf(ana, `base=USD&quote=COP&on=${RATE_DAY}&amount=5000`);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      rate: "4100",
      on: RATE_DAY,
      converted: { amount: "20500000", currency: "COP" },
    });
  });

  it("rounds the converted amount as Money.convert does: half to even, odd cents and an inverted rate", async () => {
    const ana = await person();
    // 150 JPY per dollar: 0,01 USD is 1,5 JPY → 2 and 0,03 USD is 4,5 JPY → 4 (JPY has no minor digits).
    await app.pool.query(
      `INSERT INTO exchange_rates (date, base, quote, rate, source, fetched_at)
       VALUES ($1, 'USD', 'JPY', '150', 'test', now()) ON CONFLICT DO NOTHING`,
      [RATE_DAY],
    );
    for (const [minor, expected] of [
      ["1", "2"],
      ["3", "4"],
    ] as const) {
      const body = (await (
        await rateOf(ana, `base=USD&quote=JPY&on=${RATE_DAY}&amount=${minor}`)
      ).json()) as {
        rate: string;
        converted: MoneyDto;
      };
      expect(body.converted).toEqual({ amount: expected, currency: "JPY" });
      expect(body.converted).toEqual(convertedByMoney(BigInt(minor), "USD", "JPY", body.rate));
    }
    // 205.000,01 COP to dollars goes through the inverted rate (1 / 4.100, 12 digits): odd cents, rounded once.
    const back = (await (await rateOf(ana, `base=COP&quote=USD&on=${RATE_DAY}&amount=20500001`)).json()) as {
      rate: string;
      converted: MoneyDto;
    };
    expect(back.converted).toEqual({ amount: "5000", currency: "USD" });
    expect(back.converted).toEqual(convertedByMoney(20_500_001n, "COP", "USD", back.rate));
  });

  it("answers without `converted` when no amount is asked, and refuses a malformed amount with 422", async () => {
    const ana = await person();
    const plain = await rateOf(ana, `base=USD&quote=COP&on=${RATE_DAY}`);
    expect(Object.keys((await plain.json()) as object).sort()).toEqual(["on", "rate"]);
    for (const amount of ["12.50", "abc", "", "1e3", "99999999999999999999"]) {
      expect(
        await problemOf(await rateOf(ana, `base=USD&quote=COP&on=${RATE_DAY}&amount=${amount}`)),
      ).toEqual([422, "ValidationFailed"]);
    }
    expect(await problemOf(await rateOf(ana, `base=USD&quote=COP&on=2000-01-03&amount=5000`))).toEqual([
      404,
      "ExchangeRateNotFound",
    ]);
  });
});
