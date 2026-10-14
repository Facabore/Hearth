import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, startTestApp } from "../support/app";
import {
  balanceOf,
  categoryWithKey,
  cop,
  household,
  newAccount,
  post,
  type Household,
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

interface RecordedDto extends TransactionDto {
  warnings: { code: string; accountId: string; balance: MoneyDto }[];
}
interface FundHousehold extends Household {
  readonly fund: string;
  readonly rent: string;
}

/** HU-E4-10 Background: Household with Ana and Juan and the account "Household Fund" holding 1,500,000 COP. */
const withFund = async (): Promise<FundHousehold> => {
  const h = await household();
  return {
    ...h,
    fund: await newAccount(h.ana, "Household Fund", 1_500_000, "SHARED_FUND"),
    rent: await categoryWithKey(h.ana, "rent"),
  };
};
/** Rent of `pesos` paid from `fund`, split 40% / 60% between Ana and Juan unless `extra` says otherwise. */
const rentFrom = (h: FundHousehold, fund: string, pesos: number, extra: Record<string, unknown> = {}) => ({
  description: "Rent October",
  date: "2026-10-01",
  categoryId: h.rent,
  amount: cop(pesos),
  payments: [{ memberId: null, accountId: fund, amount: cop(pesos) }],
  split: {
    method: "PERCENT",
    participants: [
      { memberId: h.ana.memberId, percent: "40" },
      { memberId: h.juan.memberId, percent: "60" },
    ],
  },
  ...extra,
});
const recorded = async (response: Response): Promise<RecordedDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as RecordedDto;
};

describe("expenses paid from the shared fund (HU-E4-10)", () => {
  it("pays rent from the fund, split 40% / 60%, and lowers the fund balance (@critical)", async () => {
    const h = await withFund();
    const rent = await recorded(await post(recordExpense, h.ana, "expenses", rentFrom(h, h.fund, 1_200_000)));
    expect(rent.payments).toEqual([{ memberId: null, accountId: h.fund, amount: cop(1_200_000) }]);
    expect(rent.shares.map((s) => [s.memberId, s.amount, s.splitMethod])).toEqual([
      [h.ana.memberId, cop(480_000), "PERCENT"],
      [h.juan.memberId, cop(720_000), "PERCENT"],
    ]);
    expect(rent.warnings).toEqual([]);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(300_000));
  });

  it("records an expense that takes the fund below zero and warns with its balance", async () => {
    const h = await withFund();
    const big = await recorded(await post(recordExpense, h.ana, "expenses", rentFrom(h, h.fund, 2_000_000)));
    expect(big.warnings).toEqual([
      { code: "FundBalanceNegative", accountId: h.fund, balance: cop(-500_000) },
    ]);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(-500_000));
  });

  it("replays the stored response, warnings included, for a repeated Idempotency-Key", async () => {
    const h = await withFund();
    const headers = { "idempotency-key": "rent-2026-10" };
    const body = rentFrom(h, h.fund, 2_000_000);
    const first = await recorded(await post(recordExpense, h.ana, "expenses", body, headers));
    const replay = await recorded(await post(recordExpense, h.ana, "expenses", body, headers));
    expect(replay).toEqual(first);
    expect(replay.warnings).toHaveLength(1);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(-500_000));
  });

  it("answers member-paid expenses with an empty warnings list", async () => {
    const h = await withFund();
    const groceries = await recorded(
      await post(recordExpense, h.ana, "expenses", {
        description: "Groceries",
        date: "2026-10-05",
        categoryId: h.groceries,
        amount: cop(100_000),
        payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(100_000) }],
      }),
    );
    expect(groceries.warnings).toEqual([]);
  });

  it("accepts only this household's own fund, as the only payer (Review Focus 3)", async () => {
    const h = await withFund();
    const other = await withFund();
    const cases: [unknown, number, string][] = [
      [rentFrom(h, other.fund, 100_000), 404, "AccountNotFound"],
      [rentFrom(h, "not-a-uuid", 100_000), 404, "AccountNotFound"],
      [rentFrom(h, h.ana.account, 100_000), 404, "AccountNotFound"],
      [
        rentFrom(h, h.fund, 100_000, { payments: [{ memberId: null, amount: cop(100_000) }] }),
        422,
        "AccountRequired",
      ],
      [
        rentFrom(h, h.fund, 100_000, {
          payments: [{ memberId: h.ana.memberId, accountId: h.fund, amount: cop(100_000) }],
        }),
        422,
        "AccountNotOwned",
      ],
      [
        rentFrom(h, h.fund, 1_200_000, {
          payments: [
            { memberId: null, accountId: h.fund, amount: cop(1_000_000) },
            { memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(200_000) },
          ],
        }),
        409,
        "MixedFundPayment",
      ],
      // The fund is the only payer: it cannot be split into several fund payments either.
      [
        rentFrom(h, h.fund, 1_200_000, {
          payments: [
            { memberId: null, accountId: h.fund, amount: cop(700_000) },
            { memberId: null, accountId: h.fund, amount: cop(500_000) },
          ],
        }),
        409,
        "MixedFundPayment",
      ],
    ];
    for (const [body, status, code] of cases) {
      expect(await problemOf(await post(recordExpense, h.ana, "expenses", body))).toEqual([status, code]);
    }
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(1_500_000));
  });
});
