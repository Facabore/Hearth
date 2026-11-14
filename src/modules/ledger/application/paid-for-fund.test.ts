import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { createConvertTransaction } from "./convert-transaction";
import { createDeleteTransaction } from "./delete-transaction";
import { createEditTransaction } from "./edit-transaction";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";
import { createRecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome } from "./record-income";
import { createRecordTransfer } from "./record-transfer";
import { createRestoreTransaction } from "./restore-transaction";

const cop = (pesos: bigint) => money(pesos * 100n);
/** D26: Ana pays the 1,200,000 COP rent for Household's fund from Bancolombia, split 40 % / 60 %. */
const rent = (overrides: Partial<RecordExpenseInput> = {}): RecordExpenseInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Arriendo",
  date: "2026-11-01" as LocalDate,
  categoryId: CATEGORIES.household.id,
  amount: cop(1_200_000n),
  paidForFund: { fundAccountId: ACCOUNTS.householdFund.id, sourceAccountId: ACCOUNTS.bancolombia.id },
  split: {
    method: "PERCENT",
    participants: [
      { memberId: "member-ana", basisPoints: 4_000 },
      { memberId: "member-juan", basisPoints: 6_000 },
    ],
  },
  ...overrides,
});

describe("an expense paid for the fund (D26, #316)", () => {
  it("records Ana's contribution to the fund and the fund's payment of the rent, linked both ways", async () => {
    const { deps, store } = householdLedger();
    const recorded = unwrap(await createRecordExpense(deps)(rent()));
    const [contribution, expense] = store.rows;
    expect(contribution).toMatchObject({
      type: "TRANSFER",
      amount: 120_000_000n,
      date: "2026-11-01",
      description: "Arriendo",
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-household-fund",
      payerMemberId: "member-ana",
      linkedTransactionId: recorded.expense.id,
    });
    expect(expense).toMatchObject({
      id: recorded.expense.id,
      type: "EXPENSE",
      amount: 120_000_000n,
      date: "2026-11-01",
      payments: [{ memberId: null, accountId: "acc-household-fund", amount: 120_000_000n }],
      linkedTransactionId: contribution!.id,
    });
    expect(recorded.expense.shares.map((s) => [s.memberId, s.amount])).toEqual([
      ["member-ana", 48_000_000n],
      ["member-juan", 72_000_000n],
    ]);
    // The fund receives and pays the same amount; Ana's account pays the rent.
    expect(store.netOf(ACCOUNTS.householdFund.id)).toBe(0n);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-120_000_000n);
    expect(recorded.warnings).toEqual([]);
  });

  it("takes the space lock for money writes", async () => {
    const { deps, locks } = householdLedger();
    unwrap(await createRecordExpense(deps)(rent()));
    expect(locks.money).toEqual(["space-household"]);
  });

  it("keeps the contribution's rules: the contributor's own account, debited only by its owner (D9)", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordExpense(deps);
    const juans = { fundAccountId: ACCOUNTS.householdFund.id, memberId: "member-juan" };
    expect(
      codeOf(await record(rent({ paidForFund: { ...juans, sourceAccountId: ACCOUNTS.davivienda.id } }))),
    ).toBe("AccountNotOwned");
    expect(codeOf(await record(rent({ paidForFund: { fundAccountId: ACCOUNTS.householdFund.id } })))).toBe(
      "AccountRequired",
    );
    expect(
      codeOf(await record(rent({ paidForFund: { ...juans, fundAccountId: ACCOUNTS.tripFund.id } }))),
    ).toBe("AccountNotFound");
    expect(store.rows).toEqual([]);
    const byJuan = rent({
      userId: "u-juan",
      paidForFund: { ...juans, sourceAccountId: ACCOUNTS.davivienda.id },
    });
    expect(codeOf(await record(byJuan))).toBe("ok");
  });

  it("names no other payer beside the fund", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordExpense(deps);
    expect(codeOf(await record(rent({ accountId: ACCOUNTS.bancolombia.id })))).toBe("InvalidPaidForFund");
    const payments = [
      { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(1_200_000n) },
    ];
    expect(codeOf(await record(rent({ payments })))).toBe("InvalidPaidForFund");
    expect(store.rows).toEqual([]);
  });

  it("records a plain expense and a plain contribution exactly as before: one row each, linked to nothing", async () => {
    const { deps, store } = householdLedger();
    unwrap(
      await createRecordExpense(deps)(rent({ paidForFund: undefined, accountId: ACCOUNTS.bancolombia.id })),
    );
    unwrap(
      await createRecordFundContribution(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        amount: cop(480_000n),
        fundAccountId: ACCOUNTS.householdFund.id,
        sourceAccountId: ACCOUNTS.bancolombia.id,
      }),
    );
    expect(store.rows).toHaveLength(2);
    expect(store.rows.map((tx) => "linkedTransactionId" in tx)).toEqual([false, false]);
  });

  it("deletes and restores both halves together, from either one", async () => {
    const { deps, store, audit } = householdLedger();
    const recorded = unwrap(await createRecordExpense(deps)(rent()));
    const contributionId = store.rows[0]!.id;
    const remove = createDeleteTransaction(deps);
    const restore = createRestoreTransaction(deps);
    const deletedAt = () => store.rows.map((tx) => tx.deletedAt !== null);
    unwrap(await remove({ spaceId: "space-household", userId: "u-ana", transactionId: contributionId }));
    expect(deletedAt()).toEqual([true, true]);
    unwrap(
      await restore({ spaceId: "space-household", userId: "u-ana", transactionId: recorded.expense.id }),
    );
    expect(deletedAt()).toEqual([false, false]);
    unwrap(await remove({ spaceId: "space-household", userId: "u-ana", transactionId: recorded.expense.id }));
    expect(deletedAt()).toEqual([true, true]);
    expect(audit.entries.map((e) => e.action)).toEqual([
      "DELETED",
      "DELETED",
      "RESTORED",
      "RESTORED",
      "DELETED",
      "DELETED",
    ]);
  });

  it("never edits one half's amount, date or payer alone, but takes a new description or split", async () => {
    const { deps, store } = householdLedger();
    const recorded = unwrap(await createRecordExpense(deps)(rent()));
    const contributionId = store.rows[0]!.id;
    const edit = (
      transactionId: string,
      changes: Parameters<ReturnType<typeof createEditTransaction>>[0]["changes"],
    ) =>
      createEditTransaction(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        transactionId,
        expectedVersion: null,
        changes,
      });
    const expenseId = recorded.expense.id;
    expect(codeOf(await edit(expenseId, { amount: cop(1_000_000n) }))).toBe("FieldNotEditable");
    expect(codeOf(await edit(contributionId, { amount: cop(1_000_000n) }))).toBe("FieldNotEditable");
    expect(codeOf(await edit(contributionId, { date: "2026-11-02" as LocalDate }))).toBe("FieldNotEditable");
    expect(codeOf(await edit(expenseId, { accountId: ACCOUNTS.bancolombia.id }))).toBe("FieldNotEditable");
    expect(codeOf(await edit(expenseId, { description: "Arriendo noviembre" }))).toBe("ok");
    expect(
      codeOf(
        await edit(expenseId, {
          split: { method: "EQUAL", participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }] },
        }),
      ),
    ).toBe("ok");
    expect(store.rows.map((tx) => tx.amount)).toEqual([120_000_000n, 120_000_000n]);
  });

  it("converts neither half into another kind of movement", async () => {
    const { deps, store } = householdLedger();
    const recorded = unwrap(await createRecordExpense(deps)(rent()));
    const convert = createConvertTransaction(deps, {
      recordExpense: createRecordExpense(deps),
      recordIncome: createRecordIncome(deps),
      recordTransfer: createRecordTransfer(deps),
      recordFundContribution: createRecordFundContribution(deps),
    });
    expect(
      codeOf(
        await convert({
          spaceId: "space-household",
          userId: "u-ana",
          transactionId: recorded.expense.id,
          expectedVersion: null,
          to: {
            type: "INCOME",
            amount: cop(1_200_000n),
            categoryId: CATEGORIES.household.id,
            accountId: "x",
          },
        }),
      ),
    ).toBe("TransactionNotConvertible");
    expect(store.rows.filter((tx) => tx.deletedAt === null)).toHaveLength(2);
  });
});
