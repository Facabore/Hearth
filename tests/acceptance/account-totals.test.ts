import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import {
  GET as getAccount,
  PATCH as updateAccount,
} from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { LocalDate } from "@/shared/kernel";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, inSpace, newAccount, post, type MoneyDto } from "../support/ledger";
import { actingIn, joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const totalsOf = async (user: TestUser, query = "") => {
  const response = await call(listAccounts, "GET", inSpace(user, `accounts${query}`), {
    user,
    params: { spaceId: user.spaceId },
  });
  expect(response.status).toBe(200);
  const { totals } = (await response.json()) as { totals: { available: MoneyDto; netWorth: MoneyDto } };
  return [totals.available, totals.netWorth];
};
const patch = (user: TestUser, accountId: string, body: unknown) =>
  call(updateAccount, "PATCH", inSpace(user, `accounts/${accountId}`), {
    user,
    params: { spaceId: user.spaceId, accountId },
    body,
  });

/** HU-E2-07 Background: Ana's five active accounts with their default switches. */
const background = async () => {
  const ana = await registerUser("Ana");
  return {
    ana,
    bancolombia: await newAccount(ana, "Bancolombia", 2_000_000, "BANK"),
    nequi: await newAccount(ana, "Nequi", 300_000, "WALLET"),
    visa: await newAccount(ana, "Visa", -350_000, "CREDIT_CARD"),
    cdt: await newAccount(ana, "CDT Davivienda", 10_000_000, "SAVINGS"),
    loan: await newAccount(ana, "Crédito libre inversión", -8_000_000, "LOAN"),
  };
};

describe("available money and net worth (HU-E2-07)", () => {
  it("totals the accounts with the default switches (@critical)", async () => {
    const w = await background();
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_950_000)]);
  });

  // D29, slice MC4 (board 8). The rate table is global, so these read days no other test stores rates for.
  const storeRate = (date: string, base: string, quote: string, rate: string) =>
    app.rates.repository.save([
      {
        date: date as LocalDate,
        base,
        quote,
        rate,
        source: "test",
        fetchedAt: new Date(`${date}T12:00:00Z`),
      },
    ]);
  const boardEight = async () => {
    const ana = await registerUser("Ana");
    await newAccount(ana, "Bancolombia", 1_469_600, "BANK");
    const dollars = await post(createAccount, ana, "accounts", {
      name: "Cuenta en dólares",
      type: "BANK",
      currency: "USD",
      openingBalance: { amount: "51240", currency: "USD" },
    });
    expect(dollars.status).toBe(201);
    return { ana, dollars: ((await dollars.json()) as { id: string }).id };
  };
  interface ConvertedList {
    items: { id: string; balance: MoneyDto; convertedBalance?: MoneyDto }[];
    totals: {
      available: MoneyDto;
      netWorth: MoneyDto;
      rateDate?: string;
      stale?: boolean;
      rates?: { currency: string; rate: string; unit: MoneyDto; date: string; stale: boolean }[];
      withoutRate?: string[];
    };
  }
  const listAsOf = async (user: TestUser, asOf: string) => {
    const response = await call(listAccounts, "GET", inSpace(user, `accounts?asOf=${asOf}`), {
      user,
      params: { spaceId: user.spaceId },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as ConvertedList;
  };

  it("converts a USD account into the COP totals at the latest rate on or before the day asked for (D29, MC4)", async () => {
    await storeRate("2031-03-15", "USD", "COP", "4100");
    const { ana, dollars } = await boardEight();
    const list = await listAsOf(ana, "2031-03-16");
    // $ 1.469.600 + US$ 512,40 at 4.100 ($ 2.100.840) is ≈ $ 3.570.440, at the rate stored on 15 March.
    expect([list.totals.available, list.totals.netWorth]).toEqual([cop(3_570_440), cop(3_570_440)]);
    expect(list.totals).toMatchObject({ rateDate: "2031-03-15", stale: false });
    expect(list.totals.rates).toEqual([
      { currency: "USD", rate: "4100", unit: cop(4_100), date: "2031-03-15", stale: false },
    ]);
    const row = list.items.find((item) => item.id === dollars)!;
    // The account keeps its exact balance in its own currency, and says what the totals counted it as.
    expect([row.balance, row.convertedBalance]).toEqual([
      { amount: "51240", currency: "USD" },
      cop(2_100_840),
    ]);
    expect(list.totals.withoutRate).toBeUndefined();
  });

  it("flags a rate more than a week older than the day asked for, and still converts with it (D29, MC4)", async () => {
    await storeRate("2032-06-15", "USD", "COP", "4100");
    const { ana } = await boardEight();
    const list = await listAsOf(ana, "2032-06-25");
    expect(list.totals.available).toEqual(cop(3_570_440));
    expect(list.totals).toMatchObject({ rateDate: "2032-06-15", stale: true });
  });

  it("leaves an account with no rate out of the totals and flags it, never at 1:1 (D29, MC4)", async () => {
    const ana = await registerUser("Ana");
    await newAccount(ana, "Bancolombia", 1_469_600, "BANK");
    const tugrik = await post(createAccount, ana, "accounts", {
      name: "Ulán Bator",
      type: "BANK",
      currency: "MNT",
      openingBalance: { amount: "5000000", currency: "MNT" },
    });
    const id = ((await tugrik.json()) as { id: string }).id;
    const list = await listAsOf(ana, "2033-01-10");
    expect([list.totals.available, list.totals.netWorth]).toEqual([cop(1_469_600), cop(1_469_600)]);
    expect(list.totals.withoutRate).toEqual([id]);
    expect(list.totals.rateDate).toBeUndefined();
    expect(list.items.find((item) => item.id === id)!.convertedBalance).toBeUndefined();
  });

  it("sends none of the conversion fields to a space with one currency (additive only)", async () => {
    const w = await background();
    const list = await listAsOf(w.ana, "2026-11-16");
    expect(Object.keys(list.totals).sort()).toEqual(["available", "netWorth"]);
  });

  it("follows the switches, and null returns a switch to its default", async () => {
    const w = await background();
    expect((await patch(w.ana, w.cdt, { includeInAvailable: true })).status).toBe(200);
    const nequi = await patch(w.ana, w.nequi, { includeInNetWorth: false });
    expect(await nequi.json()).toMatchObject({ includeInAvailable: true, includeInNetWorth: false });
    expect(await totalsOf(w.ana)).toEqual([cop(12_300_000), cop(3_650_000)]);
    expect((await patch(w.ana, w.cdt, { includeInAvailable: null })).status).toBe(200);
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_650_000)]);
  });

  it("answers the stored icon and switches beside the effective ones and the type's defaults (issue 120)", async () => {
    const w = await background();
    const read = async () =>
      (await call(getAccount, "GET", inSpace(w.ana, `accounts/${w.cdt}`), {
        user: w.ana,
        params: { spaceId: w.ana.spaceId, accountId: w.cdt },
      }).then((response) => response.json())) as Record<string, unknown>;
    const defaults = { icon: "piggy", includeInAvailable: false, includeInNetWorth: true };
    expect(await read()).toMatchObject({
      icon: "piggy",
      includeInAvailable: false,
      stored: { icon: null, includeInAvailable: null, includeInNetWorth: null },
      defaults,
    });

    const chosen = await patch(w.ana, w.cdt, { icon: "star", includeInAvailable: true });
    expect(chosen.status).toBe(200);
    expect(await chosen.json()).toMatchObject({
      icon: "star",
      includeInAvailable: true,
      stored: { icon: "star", includeInAvailable: true, includeInNetWorth: null },
      defaults,
    });

    expect((await patch(w.ana, w.cdt, { icon: null, includeInAvailable: null })).status).toBe(200);
    expect(await read()).toMatchObject({
      icon: "piggy",
      includeInAvailable: false,
      stored: { icon: null, includeInAvailable: null, includeInNetWorth: null },
      defaults,
    });
  });

  it("takes both switches in a create body, and the list totals follow them", async () => {
    const w = await background();
    const amex = await post(createAccount, w.ana, "accounts", {
      name: "Amex",
      type: "CREDIT_CARD",
      openingBalance: cop(-50_000),
      includeInAvailable: true,
      includeInNetWorth: false,
    });
    expect(amex.status).toBe(201);
    expect(await amex.json()).toMatchObject({ includeInAvailable: true, includeInNetWorth: false });
    // The card counts in available (-50,000) and stays out of net worth, unlike its type's defaults.
    expect(await totalsOf(w.ana)).toEqual([cop(2_250_000), cop(3_950_000)]);
  });

  it("counts a card payment as a transfer, so nothing counts twice (Review Focus 5)", async () => {
    const w = await background();
    const groceries = await categoryWithKey(w.ana, "groceries");
    const purchase = await post(recordExpense, w.ana, "expenses", {
      date: "2026-10-10",
      categoryId: groceries,
      amount: cop(200_000),
      accountId: w.visa,
    });
    expect(purchase.status).toBe(201);
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_750_000)]);
    const payment = await post(recordTransfer, w.ana, "transfers", {
      date: "2026-10-25",
      amount: cop(200_000),
      sourceAccountId: w.bancolombia,
      destinationAccountId: w.visa,
    });
    expect(await payment.json()).toMatchObject({ type: "TRANSFER", categoryId: null });
    const period = await call(listTransactions, "GET", inSpace(w.ana, "transactions?period=2026-10"), {
      user: w.ana,
      params: { spaceId: w.ana.spaceId },
    });
    expect(((await period.json()) as { totals: { expenses: MoneyDto } }).totals.expenses).toEqual(
      cop(200_000),
    );
    expect(await totalsOf(w.ana)).toEqual([cop(2_100_000), cop(3_750_000)]);
    expect(await totalsOf(w.ana, "?asOf=2026-10-24")).toEqual([cop(2_300_000), cop(3_750_000)]);
  });

  it("leaves archived accounts out, even when they are listed", async () => {
    const w = await background();
    const archived = await call(archiveAccount, "POST", inSpace(w.ana, `accounts/${w.nequi}/archive`), {
      user: w.ana,
      params: { spaceId: w.ana.spaceId, accountId: w.nequi },
    });
    expect(archived.status).toBe(200);
    expect(await totalsOf(w.ana)).toEqual([cop(2_000_000), cop(3_650_000)]);
    expect(await totalsOf(w.ana, "?archived=true")).toEqual([cop(2_000_000), cop(3_650_000)]);
  });

  it("totals a shared space's fund only, for every reader, and leaves personal totals alone", async () => {
    const w = await background();
    const household = actingIn(w.ana, await newSharedSpace(w.ana));
    await newAccount(household, "Household Fund", 1_500_000, "SHARED_FUND");
    const sofi = await registerUser("Sofi");
    await joinAs(w.ana, household.spaceId, sofi, "VIEWER");
    expect(await totalsOf(household)).toEqual([cop(1_500_000), cop(1_500_000)]);
    expect(await totalsOf(actingIn(sofi, household.spaceId))).toEqual([cop(1_500_000), cop(1_500_000)]);
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_950_000)]);
  });
});
