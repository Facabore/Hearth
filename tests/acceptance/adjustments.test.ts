import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as myTransactions } from "@/app/api/v1/me/transactions/route";
import { POST as recordAdjustment } from "@/app/api/v1/spaces/[spaceId]/adjustments/route";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as convertTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/convert/route";
import { POST as restoreTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/restore/route";
import {
  DELETE as deleteTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  balanceOf,
  balancesOf,
  cop,
  inSpace,
  joinHousehold,
  post,
  starterAccount,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";
import { getLineDashboard, getSpendingByGroup, getUnifiedView, reportHousehold } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const DAY = "2026-11-10";
const PERIOD = "2026-11";

const adjust = (user: TestUser, accountId: string, amount: MoneyDto, extra: Record<string, unknown> = {}) =>
  post(recordAdjustment, user, "adjustments", { accountId, amount, date: DAY, ...extra });

const recorded = async (response: Promise<Response>): Promise<TransactionDto> => {
  const answer = await response;
  expect(answer.status).toBe(201);
  return (await answer.json()) as TransactionDto;
};

const onTransaction = (
  handler: Parameters<typeof call>[0],
  method: string,
  user: TestUser,
  id: string,
  options: { body?: unknown; suffix?: string } = {},
) =>
  call(handler, method, inSpace(user, `transactions/${id}${options.suffix ?? ""}`), {
    user,
    params: { spaceId: user.spaceId, transactionId: id },
    body: options.body,
  });

const json = async <T>(response: Response | Promise<Response>): Promise<T> => {
  const answer = await response;
  expect(answer.status).toBe(200);
  return (await answer.json()) as T;
};

/**
 * Every figure besides the account's balance an adjustment must leave alone (design Q4): the personal space's totals,
 * the person's Movimientos totals, the unified view's consumption and cash out, the plan's line spent (SAVINGS lines
 * count transfers into a savings account), the household's Saldos and the account's own in and out.
 */
const figuresOf = async (r: Awaited<ReturnType<typeof reportHousehold>>) => {
  const { h } = r;
  const space = await json<{ totals: unknown }>(
    call(listTransactions, "GET", inSpace(h.ana.personal, `transactions?period=${PERIOD}`), {
      user: h.ana.personal,
      params: { spaceId: h.ana.personal.spaceId },
    }),
  );
  const mine = await json<{ totals: unknown }>(
    call(myTransactions, "GET", `/api/v1/me/transactions?period=${PERIOD}`, { user: h.ana.personal }),
  );
  const unified = await json<{ consumption: unknown; cashOut: unknown }>(
    getUnifiedView(h.ana.personal, { period: PERIOD }),
  );
  const lines = await json<{ lines: { name: string; spent: MoneyDto }[]; totals: unknown }>(
    getLineDashboard(h.ana, h.spaceId, { period: PERIOD }),
  );
  const account = await json<{ account?: unknown }>(
    getSpendingByGroup(h.ana.personal, h.ana.personal.spaceId, { period: PERIOD, accountId: h.ana.account }),
  );
  return {
    spaceTotals: space.totals,
    myTotals: mine.totals,
    consumption: unified.consumption,
    cashOut: unified.cashOut,
    lines: lines.lines.map((l) => [l.name, l.spent]),
    lineTotals: lines.totals,
    saldos: await balancesOf(h.ana, h.spaceId),
    accountFigures: account.account,
  };
};

describe("POST /api/v1/spaces/{spaceId}/adjustments (design Q4, #329)", () => {
  it("moves the account's balance by +50,000 and -20,000 COP and no other figure (@critical)", async () => {
    const r = await reportHousehold();
    const { h } = r;
    const savings = await starterAccount(h.ana.personal, "Ahorros");
    const before = await figuresOf(r);
    const opening = await balanceOf(h.ana.personal, h.ana.account);

    const inflow = await recorded(
      adjust(h.ana.personal, h.ana.account, cop(50_000), { description: "Cuadre" }),
    );
    const outflow = await recorded(adjust(h.ana.personal, h.ana.account, cop(-20_000)));
    // A savings account's adjustment is never a transfer into it, so the SAVINGS line does not move.
    await recorded(adjust(h.ana.personal, savings, cop(100_000)));
    // The household's fund, adjusted by its OWNER, moves nobody's Saldo.
    await recorded(adjust(h.ana, r.fund, cop(-30_000)));

    expect(inflow).toMatchObject({
      type: "ADJUSTMENT",
      amount: cop(50_000),
      categoryId: null,
      sourceAccountId: null,
      destinationAccountId: h.ana.account,
      payerMemberId: null,
      receivingMemberId: null,
      payments: [],
      shares: [],
      description: "Cuadre",
    });
    expect(outflow).toMatchObject({
      amount: cop(20_000),
      sourceAccountId: h.ana.account,
      destinationAccountId: null,
    });
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(
      cop(Number(BigInt(opening.amount) / 100n) + 30_000),
    );
    expect(await balanceOf(h.ana.personal, savings)).toEqual(cop(100_000));
    expect(await balanceOf(h.ana, r.fund)).toEqual(cop(1_470_000));
    expect(await figuresOf(r)).toEqual(before);
  });

  it("adjusts a USD account in USD: its balance moves in USD, the base by the date's rate", async () => {
    const r = await reportHousehold();
    const ana = r.h.ana.personal;
    const day = "2036-05-20";
    await app.pool.query(
      `INSERT INTO exchange_rates (date, base, quote, rate, source, fetched_at)
       VALUES ($1, 'USD', 'COP', '4000', 'test', now()) ON CONFLICT DO NOTHING`,
      [day],
    );
    const created = await call(createAccount, "POST", inSpace(ana, "accounts"), {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: {
        name: "Chase",
        type: "BANK",
        currency: "USD",
        openingBalance: { amount: "1000", currency: "USD" },
      },
    });
    expect(created.status).toBe(201);
    const chase = ((await created.json()) as { id: string }).id;

    const body = await recorded(adjust(ana, chase, { amount: "-250", currency: "USD" }, { date: day }));
    expect(body).toMatchObject({
      type: "ADJUSTMENT",
      amount: cop(10_000),
      sourceAccountId: chase,
      sourceAmount: { amount: "250", currency: "USD" },
    });
    expect(await balanceOf(ana, chase)).toEqual({ amount: "750", currency: "USD" });
    expect(await problemOf(await adjust(ana, chase, cop(10)))).toEqual([422, "CurrencyMismatch"]);
  });

  it("refuses a VIEWER with 403, another member's account and a zero amount with 422", async () => {
    const r = await reportHousehold();
    const { h } = r;
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect(await problemOf(await adjust(sofi, r.fund, cop(10)))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await adjust(h.ana, h.juan.account, cop(10)))).toEqual([422, "AccountNotOwned"]);
    // A MEMBER never adjusts the fund; it belongs to nobody, so only an OWNER or ADMIN does.
    expect(await problemOf(await adjust(h.juan, r.fund, cop(10)))).toEqual([422, "AccountNotOwned"]);
    expect(await problemOf(await adjust(h.ana.personal, h.ana.account, cop(0)))).toEqual([
      422,
      "InvalidAmount",
    ]);
  });

  it("is deleted and restored like any movement, edited in amount, date and description, and never converted", async () => {
    const r = await reportHousehold();
    const ana = r.h.ana.personal;
    const account = r.h.ana.account;
    const opening = await balanceOf(ana, account);
    const tx = await recorded(adjust(ana, account, cop(-20_000)));

    expect((await onTransaction(deleteTransaction, "DELETE", ana, tx.id)).status).toBe(204);
    expect(await balanceOf(ana, account)).toEqual(opening);
    expect((await onTransaction(restoreTransaction, "POST", ana, tx.id, { suffix: "/restore" })).status).toBe(
      200,
    );
    expect((await balanceOf(ana, account)).amount).toBe(String(BigInt(opening.amount) - 2_000_000n));

    const edited = await json<TransactionDto>(
      onTransaction(editTransaction, "PATCH", ana, tx.id, {
        body: { amount: cop(5_000), date: "2026-11-11", description: "Cuadre" },
      }),
    );
    expect(edited).toMatchObject({
      type: "ADJUSTMENT",
      amount: cop(5_000),
      date: "2026-11-11",
      description: "Cuadre",
      sourceAccountId: account,
    });
    expect((await balanceOf(ana, account)).amount).toBe(String(BigInt(opening.amount) - 500_000n));

    const converted = await onTransaction(convertTransaction, "POST", ana, tx.id, {
      suffix: "/convert",
      body: { type: "TRANSFER", amount: cop(5_000), sourceAccountId: account, destinationAccountId: account },
    });
    expect(await problemOf(converted)).toEqual([409, "TransactionNotConvertible"]);
  });
});
