import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { GET as transactionAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import { POST as convertTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/convert/route";
import { POST as undoConversion } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/convert/undo/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  balanceOf,
  balancesOf,
  categoryWithKey,
  cop,
  household,
  inSpace,
  newAccount,
  paysEqually,
  post,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";
import { getSpendingByGroup } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Owner extends TestUser {
  bancolombia: string;
  nequi: string;
  groceries: string;
  salary: string;
}

/** A signed-up user with Bancolombia (2,000,000 COP), Nequi (0 COP) and the seeded categories. */
const owner = async (name: string): Promise<Owner> => {
  const user = await registerUser(name);
  return {
    ...user,
    bancolombia: await newAccount(user, "Bancolombia", 2_000_000),
    nequi: await newAccount(user, "Nequi", 0),
    groceries: await categoryWithKey(user, "groceries"),
    salary: await categoryWithKey(user, "salary"),
  };
};

const date = "2026-10-05";
const recorded = async (response: Promise<Response>) => (await (await response).json()) as TransactionDto;
const convert = (user: TestUser, id: string, body: unknown, ifMatch?: string) =>
  call(convertTransaction, "POST", inSpace(user, `transactions/${id}/convert`), {
    user,
    params: { spaceId: user.spaceId, transactionId: id },
    body,
    headers: ifMatch === undefined ? {} : { "if-match": ifMatch },
  });
const undo = (user: TestUser, id: string) =>
  call(undoConversion, "POST", inSpace(user, `transactions/${id}/convert/undo`), {
    user,
    params: { spaceId: user.spaceId, transactionId: id },
  });
const answerOf = async (response: Response) =>
  [response.status, response.ok ? undefined : ((await response.json()) as { code: string }).code] as const;
const pageOf = async (user: TestUser) => {
  const response = await call(listTransactions, "GET", inSpace(user, "transactions?period=2026-10"), {
    user,
    params: { spaceId: user.spaceId },
  });
  return (await response.json()) as {
    totals: { expenses: MoneyDto; income: MoneyDto };
    items: TransactionDto[];
  };
};
const auditOf = async (user: TestUser, id: string) => {
  const response = await call(transactionAudit, "GET", inSpace(user, `transactions/${id}/audit`), {
    user,
    params: { spaceId: user.spaceId, transactionId: id },
  });
  return ((await response.json()) as { items: { action: string; changes: Record<string, unknown> }[] }).items;
};
const spentIn = async (user: TestUser, spaceId: string) =>
  ((await (await getSpendingByGroup(user, spaceId, { period: "2026-10" })).json()) as { total: MoneyDto })
    .total;

const market = (ana: Owner) => ({
  description: "Market",
  amount: cop(85_000),
  date,
  categoryId: ana.groceries,
  accountId: ana.bancolombia,
});

describe("convert a movement's type in a personal space (issue #195)", () => {
  it("turns an expense into an income: balances, totals and reports read the income once, and the audit links both", async () => {
    const ana = await owner("Ana");
    const expense = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const response = await convert(
      ana,
      expense.id,
      {
        type: "INCOME",
        description: "Refund",
        amount: cop(85_000),
        date,
        categoryId: ana.salary,
        accountId: ana.bancolombia,
      },
      '"1"',
    );
    expect(response.status).toBe(201);
    const income = (await response.json()) as TransactionDto;
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${ana.spaceId}/transactions/${income.id}`);
    expect(income).toMatchObject({
      type: "INCOME",
      description: "Refund",
      amount: cop(85_000),
      date,
      version: 1,
    });
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(2_085_000));
    const page = await pageOf(ana);
    expect(page.items.map((t) => t.id)).toEqual([income.id]);
    expect(page.totals).toEqual({ expenses: cop(0), income: cop(85_000) });
    expect(await spentIn(ana, ana.spaceId)).toEqual(cop(0));
    expect((await auditOf(ana, expense.id)).map((e) => [e.action, e.changes.convertedTo])).toEqual([
      ["DELETED", { from: null, to: income.id }],
    ]);
    expect((await auditOf(ana, income.id)).map((e) => [e.action, e.changes])).toEqual([
      ["UPDATED", { convertedFrom: { from: null, to: expense.id } }],
    ]);
  });

  it("turns an expense into a transfer between her accounts, which is not spending", async () => {
    const ana = await owner("Ana");
    const expense = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const response = await convert(ana, expense.id, {
      type: "TRANSFER",
      amount: cop(85_000),
      date,
      sourceAccountId: ana.bancolombia,
      destinationAccountId: ana.nequi,
    });
    expect(response.status).toBe(201);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
    expect(await balanceOf(ana, ana.nequi)).toEqual(cop(85_000));
    expect((await pageOf(ana)).totals).toEqual({ expenses: cop(0), income: cop(0) });
    expect(await spentIn(ana, ana.spaceId)).toEqual(cop(0));
  });

  it("turns an income and a transfer into expenses", async () => {
    const ana = await owner("Ana");
    const salary = await recorded(
      post(recordIncome, ana, "incomes", {
        amount: cop(300_000),
        date,
        categoryId: ana.salary,
        accountId: ana.bancolombia,
      }),
    );
    const move = await recorded(
      post(recordTransfer, ana, "transfers", {
        amount: cop(50_000),
        date,
        sourceAccountId: ana.bancolombia,
        destinationAccountId: ana.nequi,
      }),
    );
    const asExpense = (pesos: number, accountId: string) => ({
      type: "EXPENSE",
      amount: cop(pesos),
      date,
      categoryId: ana.groceries,
      accountId,
    });
    expect((await convert(ana, salary.id, asExpense(300_000, ana.bancolombia))).status).toBe(201);
    expect((await convert(ana, move.id, asExpense(50_000, ana.nequi))).status).toBe(201);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_700_000));
    expect(await balanceOf(ana, ana.nequi)).toEqual(cop(-50_000));
    expect((await pageOf(ana)).totals).toEqual({ expenses: cop(350_000), income: cop(0) });
    expect(await spentIn(ana, ana.spaceId)).toEqual(cop(350_000));
  });

  it("undoes a conversion: the expense comes back, the income leaves, and a second undo changes nothing", async () => {
    const ana = await owner("Ana");
    const expense = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const income = await recorded(
      convert(ana, expense.id, {
        type: "INCOME",
        amount: cop(85_000),
        date,
        categoryId: ana.salary,
        accountId: ana.bancolombia,
      }),
    );
    const undone = await undo(ana, expense.id);
    expect([undone.status, undone.headers.get("etag")]).toEqual([200, '"3"']);
    expect(((await undone.json()) as TransactionDto).type).toBe("EXPENSE");
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
    expect((await pageOf(ana)).items.map((t) => t.id)).toEqual([expense.id]);
    expect((await auditOf(ana, income.id)).map((e) => e.action)).toEqual(["UPDATED", "DELETED"]);
    expect(await answerOf(await undo(ana, expense.id))).toEqual([200, undefined]);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
  });

  it("refuses a stale version, a repeat, the same type and an archived account, and records nothing", async () => {
    const ana = await owner("Ana");
    const expense = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const toIncome = (accountId: string) => ({
      type: "INCOME",
      amount: cop(85_000),
      date,
      categoryId: ana.salary,
      accountId,
    });
    expect(await answerOf(await convert(ana, expense.id, toIncome(ana.bancolombia), '"2"'))).toEqual([
      412,
      "PreconditionFailed",
    ]);
    expect(await answerOf(await convert(ana, expense.id, { ...market(ana), type: "EXPENSE" }))).toEqual([
      422,
      "SameTransactionType",
    ]);
    await call(archiveAccount, "POST", inSpace(ana, `accounts/${ana.nequi}/archive`), {
      user: ana,
      params: { spaceId: ana.spaceId, accountId: ana.nequi },
    });
    expect(await answerOf(await convert(ana, expense.id, toIncome(ana.nequi)))).toEqual([
      409,
      "AccountArchived",
    ]);
    expect((await pageOf(ana)).items.map((t) => t.id)).toEqual([expense.id]);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
    expect((await convert(ana, expense.id, toIncome(ana.bancolombia))).status).toBe(201);
    expect(await answerOf(await convert(ana, expense.id, toIncome(ana.bancolombia)))).toEqual([
      404,
      "TransactionNotFound",
    ]);
    expect((await pageOf(ana)).items).toHaveLength(1);
  });
});

describe("convert a movement's type in a shared space (issue #195, the owner's ruling)", () => {
  it("turns Ana's shared expense into her contribution to the fund and back: balances follow, read once", async () => {
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
    const shared = await paysEqually(h.ana, 100_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(50_000)],
      [h.juan.memberId, cop(-50_000)],
    ]);
    const converted = await convert(h.ana, shared.id, {
      type: "FUND_CONTRIBUTION",
      amount: cop(100_000),
      date,
      fundAccountId: fund,
      sourceAccountId: h.ana.account,
    });
    expect(converted.status).toBe(201);
    const contribution = (await converted.json()) as TransactionDto;
    expect(contribution).toMatchObject({
      type: "TRANSFER",
      payerMemberId: h.ana.memberId,
      sourceAccountId: h.ana.account,
      destinationAccountId: fund,
    });
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_900_000));
    expect(await balanceOf(h.ana, fund)).toEqual(cop(100_000));
    expect(await spentIn(h.ana, h.spaceId)).toEqual(cop(0));
    const back = await convert(h.ana, contribution.id, {
      type: "EXPENSE",
      amount: cop(100_000),
      date,
      categoryId: h.groceries,
      payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(100_000) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    });
    expect(back.status).toBe(201);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(50_000)],
      [h.juan.memberId, cop(-50_000)],
    ]);
    expect(await balanceOf(h.ana, fund)).toEqual(cop(0));
    expect(await spentIn(h.ana, h.spaceId)).toEqual(cop(100_000));
  });

  it("refuses a MEMBER who did not record it, and an income, which a shared space cannot hold (D9)", async () => {
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
    const salary = await categoryWithKey(h.ana, "salary");
    const shared = await paysEqually(h.ana, 100_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const before = await balancesOf(h.ana, h.spaceId);
    const toContribution = { type: "FUND_CONTRIBUTION", amount: cop(100_000), date, fundAccountId: fund };
    expect(await answerOf(await convert(h.juan, shared.id, toContribution))).toEqual([
      403,
      "InsufficientRole",
    ]);
    const toIncome = { type: "INCOME", amount: cop(100_000), date, categoryId: salary, accountId: fund };
    expect(await answerOf(await convert(h.ana, shared.id, toIncome))).toEqual([422, "AccountNotOwned"]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual(before);
    expect(await spentIn(h.ana, h.spaceId)).toEqual(cop(100_000));
  });
});
