import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

const cop = (pesos: bigint) => money(pesos * 100n);
const fromFund = (accountId: string | null, pesos: bigint) => ({
  payments: [{ memberId: null, accountId, amount: cop(pesos) }],
});
/** HU-E4-10: Ana records rent paid from Household Fund (1,500,000 COP), split 40% / 60%. */
const rent = (pesos: bigint, overrides: Partial<RecordExpenseInput> = {}): RecordExpenseInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Rent October",
  date: "2026-10-01" as LocalDate,
  categoryId: CATEGORIES.household.id,
  amount: cop(pesos),
  ...fromFund(ACCOUNTS.householdFund.id, pesos),
  split: {
    method: "PERCENT",
    participants: [
      { memberId: "member-ana", basisPoints: 4_000 },
      { memberId: "member-juan", basisPoints: 6_000 },
    ],
  },
  ...overrides,
});

describe("expenses paid from the shared fund (HU-E4-10)", () => {
  it("records rent paid from the fund, split 40/60, without warnings while the fund stays positive", async () => {
    const { deps } = householdLedger();
    const recorded = unwrap(await createRecordExpense(deps)(rent(1_200_000n)));
    expect(recorded.expense.payments).toEqual([
      { memberId: null, accountId: "acc-household-fund", amount: 120_000_000n },
    ]);
    expect(recorded.expense.shares.map((s) => [s.memberId, s.amount])).toEqual([
      ["member-ana", 48_000_000n],
      ["member-juan", 72_000_000n],
    ]);
    expect(recorded.warnings).toEqual([]);
    expect(await deps.accountBalances.balanceOf("space-household", "u-ana", ACCOUNTS.householdFund.id)).toBe(
      30_000_000n,
    );
  });

  it("records an expense that takes the fund below zero and warns with the new balance", async () => {
    const { deps, store } = householdLedger();
    const recorded = unwrap(await createRecordExpense(deps)(rent(2_000_000n)));
    expect(store.rows.map((tx) => tx.id)).toEqual([recorded.expense.id]);
    expect(recorded.warnings).toEqual([
      { code: "FundBalanceNegative", accountId: "acc-household-fund", balance: -50_000_000n },
    ]);
  });

  it("never mixes the fund with member payments (D5)", async () => {
    const { deps, store } = householdLedger();
    const mixed = rent(1_200_000n, {
      payments: [
        { memberId: null, accountId: ACCOUNTS.householdFund.id, amount: cop(1_000_000n) },
        { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(200_000n) },
      ],
    });
    expect(codeOf(await createRecordExpense(deps)(mixed))).toBe("MixedFundPayment");
    expect(store.rows).toEqual([]);
  });

  it("accepts only this space's own shared fund (Review Focus 3)", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordExpense(deps);
    expect(codeOf(await record(rent(100_000n, fromFund(ACCOUNTS.tripFund.id, 100_000n))))).toBe(
      "AccountNotFound",
    );
    expect(codeOf(await record(rent(100_000n, fromFund("not-a-uuid", 100_000n))))).toBe("AccountNotFound");
    expect(codeOf(await record(rent(100_000n, fromFund(ACCOUNTS.oldFund.id, 100_000n))))).toBe(
      "AccountArchived",
    );
    expect(codeOf(await record(rent(100_000n, fromFund(null, 100_000n))))).toBe("AccountRequired");
    // The fund is nobody's account, so a member cannot pay from it in their own name.
    const inAnasName = {
      payments: [{ memberId: "member-ana", accountId: ACCOUNTS.householdFund.id, amount: cop(100_000n) }],
    };
    expect(codeOf(await record(rent(100_000n, inAnasName)))).toBe("AccountNotOwned");
    expect(store.rows).toEqual([]);
  });

  it("recognises a fund by its type, not by its missing owner", async () => {
    const { deps, store } = householdLedger();
    // An ownerless account of Household that is not a SHARED_FUND is still not a fund.
    const ownerless = rent(100_000n, fromFund(ACCOUNTS.ownerlessCash.id, 100_000n));
    expect(codeOf(await createRecordExpense(deps)(ownerless))).toBe("InvalidFundAccount");
    expect(store.rows).toEqual([]);
  });
});
