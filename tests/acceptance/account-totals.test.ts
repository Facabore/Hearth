import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { PATCH as updateAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { setContainerForTests, type Container } from "@/composition/container";
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

  it("follows the switches, and null returns a switch to its default", async () => {
    const w = await background();
    expect((await patch(w.ana, w.cdt, { includeInAvailable: true })).status).toBe(200);
    const nequi = await patch(w.ana, w.nequi, { includeInNetWorth: false });
    expect(await nequi.json()).toMatchObject({ includeInAvailable: true, includeInNetWorth: false });
    expect(await totalsOf(w.ana)).toEqual([cop(12_300_000), cop(3_650_000)]);
    expect((await patch(w.ana, w.cdt, { includeInAvailable: null })).status).toBe(200);
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_650_000)]);
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
