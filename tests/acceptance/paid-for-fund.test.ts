import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getSuggestions } from "@/app/api/v1/spaces/[spaceId]/balances/suggestions/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as restoreTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/restore/route";
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import { balanceOf, balancesOf, cop, post } from "../support/ledger";
import { getFundContributions, reportHousehold, type FundContributionsDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface RecordedDto {
  id: string;
  type: string;
  payments: { memberId: string | null; accountId: string | null; amount: unknown }[];
  linkedTransactionId?: string | null;
}

const transactionPath = (spaceId: string, id: string) => `/api/v1/spaces/${spaceId}/transactions/${id}`;
const statusOf = async (user: TestUser, spaceId: string, id: string) =>
  (
    await call(getTransaction, "GET", transactionPath(spaceId, id), {
      user,
      params: { spaceId, transactionId: id },
    })
  ).status;

/** D26: Household's reference plan (Rent is a SHARED_FUND line) and a fund opened with 1,500,000 COP. */
const background = async () => {
  const r = await reportHousehold();
  const { h, fund, category } = r;
  /** Ana pays the 1,200,000 COP rent for the fund from her Bancolombia, split by the default split. */
  const payRent = (body: Record<string, unknown> = {}) =>
    post(recordExpense, h.ana, "expenses", {
      description: "Arriendo",
      date: "2026-11-01",
      categoryId: category.rent,
      amount: cop(1_200_000),
      paidForFund: { fundAccountId: fund, sourceAccountId: h.ana.account },
      ...body,
    });
  return { ...r, payRent };
};

const actualOf = async (user: TestUser, spaceId: string, memberId: string) => {
  const response = await getFundContributions(user, spaceId, { period: "2026-11" });
  const report = (await response.json()) as FundContributionsDto;
  return report.members.find((m) => m.memberId === memberId)!.actual;
};

describe("an expense paid for the fund over HTTP (D26, #316)", () => {
  it("records the fund's payment of the rent and Ana's contribution, linked both ways", async () => {
    const { h, fund, payRent } = await background();
    const response = await payRent();
    expect(response.status).toBe(201);
    const expense = (await response.json()) as RecordedDto;
    expect(expense.payments).toEqual([{ memberId: null, accountId: fund, amount: cop(1_200_000) }]);
    const contributionId = expense.linkedTransactionId!;
    const contribution = await call(getTransaction, "GET", transactionPath(h.spaceId, contributionId), {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: contributionId },
    });
    expect(await contribution.json()).toMatchObject({
      type: "TRANSFER",
      amount: cop(1_200_000),
      sourceAccountId: h.ana.account,
      destinationAccountId: fund,
      payerMemberId: h.ana.memberId,
      linkedTransactionId: expense.id,
    });
  });

  it("leaves no debt in Saldos, counts in Ana's actual for the fund, and keeps the fund's balance", async () => {
    const { h, fund, payRent } = await background();
    expect((await payRent()).status).toBe(201);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
    const suggestions = await call(
      getSuggestions,
      "GET",
      `/api/v1/spaces/${h.spaceId}/balances/suggestions`,
      {
        user: h.ana,
        params: { spaceId: h.spaceId },
      },
    );
    expect(((await suggestions.json()) as { suggestions: unknown[] }).suggestions).toEqual([]);
    expect(await actualOf(h.ana, h.spaceId, h.ana.memberId)).toEqual(cop(1_200_000));
    expect(await balanceOf(h.ana, fund)).toEqual(cop(1_500_000));
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(800_000));
  });

  it("deletes and restores both halves from either one", async () => {
    const { h, payRent } = await background();
    const expense = (await (await payRent()).json()) as RecordedDto;
    const contributionId = expense.linkedTransactionId!;
    const params = { spaceId: h.spaceId, transactionId: contributionId };
    const removed = await call(deleteTransaction, "DELETE", transactionPath(h.spaceId, contributionId), {
      user: h.ana,
      params,
    });
    expect(removed.status).toBe(204);
    expect([
      await statusOf(h.ana, h.spaceId, expense.id),
      await statusOf(h.ana, h.spaceId, contributionId),
    ]).toEqual([404, 404]);
    expect(await actualOf(h.ana, h.spaceId, h.ana.memberId)).toEqual(cop(0));
    const restored = await call(
      restoreTransaction,
      "POST",
      `${transactionPath(h.spaceId, expense.id)}/restore`,
      {
        user: h.ana,
        params: { spaceId: h.spaceId, transactionId: expense.id },
      },
    );
    expect(restored.status).toBe(200);
    expect([
      await statusOf(h.ana, h.spaceId, expense.id),
      await statusOf(h.ana, h.spaceId, contributionId),
    ]).toEqual([200, 200]);
  });

  it("refuses another payer beside the fund at the edge", async () => {
    const { h, payRent } = await background();
    expect(await problemOf(await payRent({ accountId: h.ana.account }))).toEqual([422, "ValidationFailed"]);
  });

  it("records a plain expense and a plain contribution exactly as before, linked to nothing", async () => {
    const { h, fund, category } = await background();
    const expense = await post(recordExpense, h.ana, "expenses", {
      date: "2026-11-01",
      categoryId: category.rent,
      amount: cop(100_000),
      accountId: h.ana.account,
    });
    expect(expense.status).toBe(201);
    expect(await expense.json()).not.toHaveProperty("linkedTransactionId");
    const contribution = await post(recordContribution, h.ana, "fund-contributions", {
      date: "2026-11-01",
      amount: cop(100_000),
      fundAccountId: fund,
      sourceAccountId: h.ana.account,
    });
    expect(contribution.status).toBe(201);
    expect(await contribution.json()).not.toHaveProperty("linkedTransactionId");
  });
});
