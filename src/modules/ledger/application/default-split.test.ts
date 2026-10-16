import { describe, expect, it } from "vitest";
import type { LocalDate, TransactionManager } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, householdLedger } from "../../../../tests/support/in-memory-ledger";
import type { Expense, Transaction } from "../domain/transaction";
import type { DefaultSplitQuery, DefaultSplitSource } from "./ports";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

const cop = (pesos: bigint) => money(pesos * 100n);

/** Budgeting's answer for Home in the ACTIVE 2026-11 plan, Ana 588,000 and Juan 882,000 COP; records each ask. */
const budgeting = (
  answer: readonly { memberId: string; weight: bigint }[] | null = [
    { memberId: "member-ana", weight: 58_800_000n },
    { memberId: "member-juan", weight: 88_200_000n },
  ],
) => {
  const asked: DefaultSplitQuery[] = [];
  const defaultSplits: DefaultSplitSource = {
    allocationWeights: async (expense) => {
      asked.push(expense);
      return answer;
    },
  };
  return { defaultSplits, asked };
};

/** HU-E6-08: Ana pays `pesos` of household groceries alone from Bancolombia on 2026-11-08, choosing no split. */
const groceries = (pesos: bigint, overrides: Partial<RecordExpenseInput> = {}): RecordExpenseInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Groceries",
  date: "2026-11-08" as LocalDate,
  categoryId: CATEGORIES.household.id,
  amount: cop(pesos),
  payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(pesos) }],
  ...overrides,
});
const sharesOf = (rows: readonly Transaction[]) =>
  (rows.at(-1) as Expense).shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

describe("the default split of RecordExpense (HU-E6-08, spec 5.3)", () => {
  it("defaults to BY_ALLOCATION by Home's assigned amounts: 800,000 COP for Ana, 1,200,000 COP for Juan (golden)", async () => {
    const { defaultSplits, asked } = budgeting();
    const { deps, store } = householdLedger(undefined, { defaultSplits });
    unwrap(await createRecordExpense(deps)(groceries(2_000_000n)));
    expect(sharesOf(store.rows)).toEqual([
      ["member-ana", 80_000_000n, "BY_ALLOCATION"],
      ["member-juan", 120_000_000n, "BY_ALLOCATION"],
    ]);
    expect(asked).toEqual([
      { spaceId: "space-household", currency: "COP", categoryId: "cat-household", date: "2026-11-08" },
    ]);
  });

  it("defaults to EQUAL among every current member when budgeting has no allocated line", async () => {
    const { defaultSplits } = budgeting(null);
    const { deps, store } = householdLedger(undefined, { defaultSplits });
    unwrap(await createRecordExpense(deps)(groceries(500_000n)));
    expect(sharesOf(store.rows)).toEqual(
      ["member-ana", "member-juan", "member-luis", "member-sofi", "member-pedro"].map((memberId) => [
        memberId,
        10_000_000n,
        "EQUAL",
      ]),
    );
  });

  it("keeps the split the member chose, and never asks for a default", async () => {
    const { defaultSplits, asked } = budgeting();
    const { deps, store } = householdLedger(undefined, { defaultSplits });
    const split = {
      method: "EQUAL" as const,
      participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }],
    };
    unwrap(await createRecordExpense(deps)(groceries(2_000_000n, { split })));
    expect(sharesOf(store.rows)).toEqual([
      ["member-ana", 100_000_000n, "EQUAL"],
      ["member-juan", 100_000_000n, "EQUAL"],
    ]);
    expect(asked).toEqual([]);
  });

  it("asks for the default of today in the space timezone when the expense has no date", async () => {
    const { defaultSplits, asked } = budgeting();
    const { deps } = householdLedger(undefined, { defaultSplits });
    unwrap(await createRecordExpense(deps)(groceries(2_000_000n, { date: undefined })));
    expect(asked.map((a) => a.date)).toEqual(["2026-10-28"]);
  });

  it("refuses a closed period before reading any default (P14, Review Focus 1)", async () => {
    const { defaultSplits, asked } = budgeting();
    const { deps } = householdLedger(undefined, {
      defaultSplits,
      closedPeriods: { isClosed: async () => true },
    });
    expect(codeOf(await createRecordExpense(deps)(groceries(2_000_000n)))).toBe("PeriodClosed");
    expect(asked).toEqual([]);
  });

  it("reads the default after the closed-period guard and inside the same transaction (P14)", async () => {
    let open = 0;
    const tm: TransactionManager = {
      run: async (work) => {
        open += 1;
        try {
          return await work();
        } finally {
          open -= 1;
        }
      },
    };
    const reads: string[] = [];
    const where = () => (open === 1 ? "in the transaction" : "outside it");
    const { deps } = householdLedger(undefined, {
      tm,
      closedPeriods: {
        isClosed: async () => {
          reads.push(`closed-period guard ${where()}`);
          return false;
        },
      },
      defaultSplits: {
        allocationWeights: async () => {
          reads.push(`default split ${where()}`);
          return null;
        },
      },
    });
    unwrap(await createRecordExpense(deps)(groceries(500_000n)));
    expect(reads).toEqual(["closed-period guard in the transaction", "default split in the transaction"]);
  });

  it("refuses a weight that is not positive and records nothing (Review Focus 4)", async () => {
    const { defaultSplits } = budgeting([
      { memberId: "member-ana", weight: 0n },
      { memberId: "member-juan", weight: 88_200_000n },
    ]);
    const { deps, store } = householdLedger(undefined, { defaultSplits });
    expect(codeOf(await createRecordExpense(deps)(groceries(2_000_000n)))).toBe("InvalidSplit");
    expect(store.rows).toEqual([]);
  });
});
