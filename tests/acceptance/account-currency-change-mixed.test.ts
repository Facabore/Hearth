import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import {
  GET as previewCurrency,
  PUT as changeCurrency,
} from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/currency/route";
import { POST as recordAdjustment } from "@/app/api/v1/spaces/[spaceId]/adjustments/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, startTestApp, type TestUser } from "../support/app";
import {
  balanceOf,
  balancesOf,
  categoryWithKey,
  cop,
  household,
  inSpace,
  memberIdOf,
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

const usd = (cents: number): MoneyDto => ({ amount: String(cents), currency: "USD" });
const eur = (cents: number): MoneyDto => ({ amount: String(cents), currency: "EUR" });
const DAY = "2037-04-14";

const made = async (response: Promise<Response>) => {
  const answer = await response;
  const body = (await answer.json()) as { id: string } & TransactionDto;
  expect(answer.status, JSON.stringify(body)).toBe(201);
  return body;
};
const tx = async (user: TestUser, id: string) =>
  (await (
    await call(getTransaction, "GET", inSpace(user, `transactions/${id}`), {
      user,
      params: { spaceId: user.spaceId, transactionId: id },
    })
  ).json()) as TransactionDto;

describe("changing an account's currency across every movement kind (P336, independent verifier's probe)", () => {
  it("transfers both ways, cross-currency transfer, adjustment, multi-payment expense, settlements, fund contribution, deleted, archived", async () => {
    for (const [base, quote, rate] of [
      ["USD", "COP", "4000"],
      ["EUR", "COP", "4400"],
    ]) {
      await app.pool.query(
        `INSERT INTO exchange_rates (date, base, quote, rate, source, fetched_at)
         VALUES ($1, $2, $3, $4, 'test', now()) ON CONFLICT DO NOTHING`,
        [DAY, base, quote, rate],
      );
    }
    const h = await household();
    const ana = h.ana.personal;
    const dollars = (
      await made(
        post(createAccount, ana, "accounts", {
          name: "Dólares",
          type: "BANK",
          currency: "USD",
          openingBalance: usd(12_037),
        }),
      )
    ).id;
    const euros = (
      await made(
        post(createAccount, ana, "accounts", {
          name: "Euros",
          type: "BANK",
          currency: "EUR",
          openingBalance: eur(50_000),
        }),
      )
    ).id;
    const pesos = await newAccount(ana, "Pesos", 1_000_000);
    const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
    const salary = await categoryWithKey(ana, "salary");
    const personalGroceries = await categoryWithKey(ana, "groceries");
    const me = await memberIdOf(ana, ana.spaceId, "Ana");

    // 1. dollars → pesos (pesos has no leg), 2. pesos → dollars, 3. dollars → euros (both legs).
    const t1 = await made(
      post(recordTransfer, ana, "transfers", {
        date: DAY,
        amount: usd(10_013),
        destinationAmount: cop(402_017),
        sourceAccountId: dollars,
        destinationAccountId: pesos,
      }),
    );
    const t2 = await made(
      post(recordTransfer, ana, "transfers", {
        date: DAY,
        amount: cop(200_011),
        destinationAmount: usd(5_003),
        sourceAccountId: pesos,
        destinationAccountId: dollars,
      }),
    );
    const t3 = await made(
      post(recordTransfer, ana, "transfers", {
        date: DAY,
        amount: usd(1_007),
        destinationAmount: eur(911),
        sourceAccountId: dollars,
        destinationAccountId: euros,
      }),
    );
    // 4. adjustment out, 5. expense of her own space paid from two accounts.
    await made(
      post(recordAdjustment, ana, "adjustments", { accountId: dollars, amount: usd(-503), date: DAY }),
    );
    const e1 = await made(
      post(recordExpense, ana, "expenses", {
        description: "Dos pagos",
        date: DAY,
        categoryId: personalGroceries,
        amount: cop(100_000),
        payments: [{ memberId: me, accountId: dollars, amount: cop(100_000) }],
        split: { method: "EQUAL", participants: [{ memberId: me }] },
      }),
    );
    // 6. household: market paid from dollars, Ana settles from dollars, Juan settles into dollars, fund contribution.
    const market = await made(
      post(recordExpense, h.ana, "expenses", {
        description: "Mercado",
        date: DAY,
        categoryId: h.groceries,
        amount: cop(300_000),
        payments: [
          { memberId: h.ana.memberId, accountId: dollars, amount: cop(180_001) },
          { memberId: h.juan.memberId, amount: cop(119_999) },
        ],
        split: {
          method: "EQUAL",
          participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }],
        },
      }),
    );
    const s1 = await made(
      post(recordSettlement, h.ana, "settlements", {
        date: DAY,
        amount: cop(40_000),
        payerMemberId: h.ana.memberId,
        receivingMemberId: h.juan.memberId,
        sourceAccountId: dollars,
      }),
    );
    const s2 = await made(
      post(recordSettlement, h.juan, "settlements", {
        date: DAY,
        amount: cop(20_000),
        payerMemberId: h.juan.memberId,
        receivingMemberId: h.ana.memberId,
        destinationAccountId: dollars,
      }),
    );
    const contribution = await post(recordContribution, h.ana, "fund-contributions", {
      date: DAY,
      amount: cop(80_000),
      fundAccountId: fund,
      sourceAccountId: dollars,
    });
    expect(contribution.status).toBe(201);
    // 7. a deleted income.
    const gone = await made(
      post(recordIncome, ana, "incomes", {
        description: "Borrada",
        amount: usd(777),
        date: DAY,
        categoryId: salary,
        accountId: dollars,
      }),
    );
    const deleted = await call(deleteTransaction, "DELETE", inSpace(ana, `transactions/${gone.id}`), {
      user: ana,
      params: { spaceId: ana.spaceId, transactionId: gone.id },
    });
    expect(deleted.status).toBe(204);
    const goneRow = async () =>
      (
        await app.pool.query(
          "SELECT amount, destination_amount, destination_currency, version FROM transactions WHERE id = $1",
          [gone.id],
        )
      ).rows[0];
    const goneBefore = await goneRow();

    const others = {
      pesos: await balanceOf(ana, pesos),
      euros: await balanceOf(ana, euros),
      fund: await balanceOf(h.ana, fund),
      juan: await balanceOf(h.juan.personal, h.juan.account),
      household: await balancesOf(h.ana, h.spaceId),
    };
    const marketBefore = await tx(h.ana, market.id);
    const s1Before = await tx(h.ana, s1.id);

    // Archive the account first (S6: archived accounts may change too). Archive may refuse a non-zero balance.
    const archived = await call(archiveAccount, "POST", inSpace(ana, `accounts/${dollars}/archive`), {
      user: ana,
      params: { spaceId: ana.spaceId, accountId: dollars },
    });
    expect(archived.status).toBe(200);

    const previewed = await call(
      previewCurrency,
      "GET",
      inSpace(ana, `accounts/${dollars}/currency?currency=COP&rate=4123.7`),
      {
        user: ana,
        params: { spaceId: ana.spaceId, accountId: dollars },
      },
    );
    const preview = (await previewed.json()) as {
      balanceAfter: MoneyDto;
      movements: number;
      balanceBefore: MoneyDto;
    };
    expect(previewed.status, JSON.stringify(preview)).toBe(200);
    const balanceBefore = await balanceOf(ana, dollars);
    expect(preview.balanceBefore).toEqual(balanceBefore);

    const changed = await call(changeCurrency, "PUT", inSpace(ana, `accounts/${dollars}/currency`), {
      user: ana,
      params: { spaceId: ana.spaceId, accountId: dollars },
      body: { currency: "COP", rate: "4123.7" },
    });
    const changedBody = (await changed.json()) as { balance: MoneyDto };
    expect(changed.status, JSON.stringify(changedBody)).toBe(200);
    expect(changedBody.balance).toEqual(preview.balanceAfter);
    expect(await balanceOf(ana, dollars)).toEqual(preview.balanceAfter);

    // Others untouched.
    expect({
      pesos: await balanceOf(ana, pesos),
      euros: await balanceOf(ana, euros),
      fund: await balanceOf(h.ana, fund),
      juan: await balanceOf(h.juan.personal, h.juan.account),
      household: await balancesOf(h.ana, h.spaceId),
    }).toEqual(others);
    const marketAfter = await tx(h.ana, market.id);
    expect(marketAfter.amount).toEqual(marketBefore.amount);
    expect(marketAfter.shares).toEqual(marketBefore.shares);
    expect((await tx(h.ana, s1.id)).amount).toEqual(s1Before.amount);
    expect(await goneRow()).toEqual(goneBefore);

    // Audit row per changed live movement.
    const audits = await app.pool.query(
      "SELECT transaction_id, count(*)::int AS n FROM transaction_audit WHERE transaction_id = ANY($1) AND action = 'UPDATED' GROUP BY transaction_id",
      [[t1.id, t2.id, t3.id, e1.id, market.id, s1.id, s2.id, gone.id]],
    );
    const audited = new Map(audits.rows.map((r) => [r.transaction_id as string, r.n as number]));
    expect([t1.id, t2.id, t3.id, e1.id, market.id, s1.id, s2.id].map((id) => audited.get(id) ?? 0)).toEqual([
      1, 1, 1, 1, 1, 1, 1,
    ]);
    expect(audited.get(gone.id) ?? 0).toBe(0);
  });

  it("Juan, a MEMBER, cannot change the household fund (fund.manage), and Ana can", async () => {
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 1_000, "SHARED_FUND");
    const put = (user: TestUser) =>
      call(changeCurrency, "PUT", inSpace(user, `accounts/${fund}/currency`), {
        user,
        params: { spaceId: user.spaceId, accountId: fund },
        body: { currency: "USD", rate: "0.00025" },
      });
    const refused = await put(h.juan);
    expect(refused.status).toBe(403);
    expect(await balanceOf(h.ana, fund)).toEqual(cop(1_000));
    expect((await put(h.ana)).status).toBe(200);
    expect(await balanceOf(h.ana, fund)).toEqual(usd(25));
  });
});
