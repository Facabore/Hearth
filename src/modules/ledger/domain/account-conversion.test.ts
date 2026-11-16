import { describe, expect, it } from "vitest";
import { ExchangeRate, type LocalDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { accountMovement, convertedForAccount, type AccountConversion } from "./account-conversion";
import type { Expense, Income, Settlement, Transaction, TransactionId, Transfer } from "./transaction";

const X = "account-x";
const Y = "account-y";
const OWN = "personal";
const SHARED = "household";

const base = {
  id: "tx-1" as TransactionId,
  spaceId: OWN,
  description: "",
  date: "2026-11-10" as LocalDate,
  occurredAt: null,
  timeZone: null,
  currency: "COP",
  createdBy: "ana",
  createdAt: new Date("2026-11-10T12:00:00Z"),
  updatedAt: new Date("2026-11-10T12:00:00Z"),
  deletedAt: null,
  version: 1,
};

const usdToCop = (rate: string, open = true): AccountConversion => ({
  accountId: X,
  accountSpaceId: OWN,
  from: "USD",
  to: "COP",
  rate: unwrap(ExchangeRate.of("USD", "COP", rate)),
  periodOpen: () => open,
});

const income = (fields: Partial<Income> = {}): Income => ({
  ...base,
  type: "INCOME",
  amount: 40_000_000n,
  categoryId: "salary",
  destinationAccountId: X,
  receivingMemberId: "ana-member",
  destinationAmount: 10_000n,
  destinationCurrency: "USD",
  ...fields,
});

const convert = (tx: Transaction, conversion = usdToCop("4000")) =>
  unwrap(convertedForAccount(tx, conversion));

describe("an account's movements in a new currency (P336)", () => {
  it("an income of its own space follows the account: its amount is what the account received, at the rate", () => {
    const after = convert(income(), usdToCop("4020.50")) as Income;
    // US$ 100,00 at 4.020,50 is $ 402.050,00, which becomes the income's amount; the account needs no leg.
    expect(after.amount).toBe(40_205_000n);
    expect(after.destinationAmount).toBeUndefined();
    expect(after.destinationCurrency).toBeUndefined();
  });

  it("a rate of 1 keeps the figures and only changes their currency", () => {
    const after = convert(income({ amount: 25n, destinationAmount: 10_000n }), usdToCop("1")) as Income;
    expect(after.amount).toBe(10_000n);
  });

  it("an original entered in the account's old currency goes with it", () => {
    const after = convert(income({ originalAmount: 10_000n, originalCurrency: "USD" })) as Income;
    expect(after.originalAmount).toBeUndefined();
    expect(after.originalCurrency).toBeUndefined();
  });

  it("a movement in a closed period keeps its amount; only the account's leg converts", () => {
    const after = convert(income(), usdToCop("4100", false)) as Income;
    expect(after.amount).toBe(40_000_000n);
    expect([after.destinationAmount, after.destinationCurrency]).toEqual([41_000_000n, "COP"]);
  });

  it("an expense of another space keeps its amount and parts; the payment's leg converts", () => {
    const expense: Expense = {
      ...base,
      spaceId: SHARED,
      type: "EXPENSE",
      amount: 30_000_000n,
      categoryId: "groceries",
      payments: [
        { memberId: "ana", accountId: X, amount: 30_000_000n, accountAmount: 7_500n, accountCurrency: "USD" },
      ],
      shares: [
        { memberId: "ana", amount: 15_000_000n, splitMethod: "EQUAL" },
        { memberId: "juan", amount: 15_000_000n, splitMethod: "EQUAL" },
      ],
    };
    const after = convert(expense, usdToCop("4100")) as Expense;
    expect(after.amount).toBe(30_000_000n);
    expect(after.shares).toEqual(expense.shares);
    expect(after.payments[0]).toMatchObject({
      amount: 30_000_000n,
      accountAmount: 30_750_000n,
      accountCurrency: "COP",
    });
  });

  it("a leg that ends equal to the movement's amount is not stored", () => {
    const after = convert(
      { ...income({ spaceId: SHARED, amount: 40_000_000n }) },
      usdToCop("4000"),
    ) as Income;
    expect(after.destinationAmount).toBeUndefined();
  });

  it("an expense of its own space paid only from it, for one person, follows the account with its payment and share", () => {
    const expense: Expense = {
      ...base,
      type: "EXPENSE",
      amount: 8_000_000n,
      categoryId: "restaurants",
      payments: [
        { memberId: "ana", accountId: X, amount: 8_000_000n, accountAmount: 2_000n, accountCurrency: "USD" },
      ],
      shares: [{ memberId: "ana", amount: 8_000_000n, splitMethod: "EQUAL" }],
    };
    const after = convert(expense, usdToCop("4100")) as Expense;
    expect(after.amount).toBe(8_200_000n);
    expect(after.payments).toEqual([{ memberId: "ana", accountId: X, amount: 8_200_000n }]);
    expect(after.shares).toEqual([{ memberId: "ana", amount: 8_200_000n, splitMethod: "EQUAL" }]);
  });

  it("a transfer to an account in the space's currency keeps its amount, so the other account is untouched", () => {
    const transfer: Transfer = {
      ...base,
      type: "TRANSFER",
      amount: 40_000_000n,
      categoryId: null,
      sourceAccountId: X,
      destinationAccountId: Y,
      payerMemberId: null,
      sourceAmount: 10_000n,
      sourceCurrency: "USD",
    };
    const after = convert(transfer, usdToCop("4100")) as Transfer;
    expect(after.amount).toBe(40_000_000n);
    expect([after.sourceAmount, after.sourceCurrency]).toEqual([41_000_000n, "COP"]);
    expect(after.destinationAmount).toBeUndefined();
  });

  it("an account in the space's currency moving to another one gets a leg on every movement", () => {
    const after = convert(
      income({ amount: 41_000_000n, destinationAmount: undefined, destinationCurrency: undefined }),
      {
        ...usdToCop("1"),
        from: "COP",
        to: "USD",
        rate: unwrap(ExchangeRate.of("COP", "USD", "0.00025")),
      },
    ) as Income;
    expect(after.amount).toBe(41_000_000n);
    expect([after.destinationAmount, after.destinationCurrency]).toEqual([10_250n, "USD"]);
  });

  it("a settlement never changes what was settled; the account's leg converts", () => {
    const settlement: Settlement = {
      ...base,
      type: "SETTLEMENT",
      amount: 40_000_000n,
      categoryId: null,
      payerMemberId: "ana",
      receivingMemberId: "juan",
      sourceAccountId: X,
      destinationAccountId: null,
      reason: "PAYMENT",
      onBehalfOfMemberId: null,
      linkedTransactionId: null,
      sourceAmount: 10_000n,
      sourceCurrency: "USD",
    };
    const after = convert(settlement, usdToCop("4100")) as Settlement;
    expect(after.amount).toBe(40_000_000n);
    expect([after.sourceAmount, after.sourceCurrency]).toEqual([41_000_000n, "COP"]);
  });

  it("refuses a rate that turns a movement into nothing", () => {
    const result = convertedForAccount(income({ destinationAmount: 1n }), {
      ...usdToCop("1"),
      rate: unwrap(ExchangeRate.of("USD", "COP", "0.001")),
    });
    expect(result.ok ? null : result.error.code).toBe("ConvertedAmountTooSmall");
  });

  it("says what a movement moved the account by, signed as its balance counts it", () => {
    const transfer: Transfer = {
      ...base,
      type: "TRANSFER",
      amount: 40_000_000n,
      categoryId: null,
      sourceAccountId: X,
      destinationAccountId: Y,
      payerMemberId: null,
      sourceAmount: 10_000n,
      sourceCurrency: "USD",
    };
    expect(accountMovement(transfer, X)).toBe(-10_000n);
    expect(accountMovement(transfer, Y)).toBe(40_000_000n);
    expect(accountMovement(income(), X)).toBe(10_000n);
  });
});
