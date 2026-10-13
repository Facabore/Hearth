import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import type { Expense, Transaction } from "../domain/transaction";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

const cop = (pesos: bigint) => money(pesos * 100n);
const equal = (...memberIds: string[]) => ({
  method: "EQUAL" as const,
  participants: memberIds.map((memberId) => ({ memberId })),
});
/** In Household, Ana pays `pesos` from Bancolombia and splits them equally with Juan. */
const groceries = (pesos: bigint, overrides: Partial<RecordExpenseInput> = {}): RecordExpenseInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Groceries",
  date: "2026-10-05" as LocalDate,
  categoryId: CATEGORIES.household.id,
  amount: cop(pesos),
  payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(pesos) }],
  split: equal("member-ana", "member-juan"),
  ...overrides,
});
/** The expense the use case stored last. */
const lastExpense = (rows: readonly Transaction[]): Expense => {
  const tx = rows.at(-1);
  if (tx?.type !== "EXPENSE") throw new Error("no expense was recorded");
  return tx;
};
const sharesOf = (tx: Expense) => tx.shares.map((share) => [share.memberId, share.amount]);

describe("RecordExpense with members' payments and an equal split (HU-E4-07)", () => {
  it("records Ana's payment and equal shares for Ana and Juan", async () => {
    const { deps, store } = householdLedger();
    expect(codeOf(await createRecordExpense(deps)(groceries(300_000n)))).toBe("ok");
    const tx = lastExpense(store.rows);
    expect(tx).toMatchObject({ spaceId: "space-household", amount: 30_000_000n, createdBy: "u-ana" });
    expect(tx.payments).toEqual([
      { memberId: "member-ana", accountId: "acc-bancolombia", amount: 30_000_000n },
    ]);
    expect(tx.shares).toEqual([
      { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
    ]);
  });

  it("gives the remainder peso to the earliest-joined participant", async () => {
    const { deps, store } = householdLedger();
    const split = equal("member-luis", "member-juan", "member-ana");
    expect(codeOf(await createRecordExpense(deps)(groceries(100_000n, { split })))).toBe("ok");
    expect(sharesOf(lastExpense(store.rows))).toEqual([
      ["member-ana", 3_333_400n],
      ["member-juan", 3_333_300n],
      ["member-luis", 3_333_300n],
    ]);
  });

  it("lets the payer stay out of the split", async () => {
    const { deps, store } = householdLedger();
    expect(codeOf(await createRecordExpense(deps)(groceries(80_000n, { split: equal("member-juan") })))).toBe(
      "ok",
    );
    expect(sharesOf(lastExpense(store.rows))).toEqual([["member-juan", 8_000_000n]]);
  });

  it("records a taxi paid by the guest Pedro outside the app", async () => {
    const { deps, store } = householdLedger();
    const taxi = groceries(90_000n, {
      description: "Taxi",
      payments: [{ memberId: "member-pedro", accountId: null, amount: cop(90_000n) }],
      split: equal("member-ana", "member-juan", "member-pedro"),
    });
    expect(codeOf(await createRecordExpense(deps)(taxi))).toBe("ok");
    const tx = lastExpense(store.rows);
    expect(tx.payments).toEqual([{ memberId: "member-pedro", accountId: null, amount: 9_000_000n }]);
    expect(sharesOf(tx)).toEqual([
      ["member-ana", 3_000_000n],
      ["member-juan", 3_000_000n],
      ["member-pedro", 3_000_000n],
    ]);
    expect(tx.createdBy).toBe("u-ana");
  });

  it("lets only the account's owner record a payment from it (D9)", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordExpense(deps);
    const payments = [{ memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: cop(300_000n) }];
    // Ana cannot spend from Juan's account, even naming Juan as the payer.
    expect(codeOf(await record(groceries(300_000n, { payments })))).toBe("AccountNotOwned");
    expect(store.rows).toEqual([]);
    // Juan records his own payment from his own account.
    expect(codeOf(await record(groceries(300_000n, { userId: "u-juan", payments })))).toBe("ok");
    expect(lastExpense(store.rows)).toMatchObject({
      createdBy: "u-juan",
      payments: [{ memberId: "member-juan", accountId: "acc-davivienda", amount: 30_000_000n }],
    });
  });

  it("shares equally among every current member when no split is given (spec 5.3)", async () => {
    const { deps, store } = householdLedger([memberOf("Ana", "OWNER", 0), memberOf("Juan", "MEMBER", 1)]);
    expect(codeOf(await createRecordExpense(deps)(groceries(300_000n, { split: undefined })))).toBe("ok");
    expect(sharesOf(lastExpense(store.rows))).toEqual([
      ["member-ana", 15_000_000n],
      ["member-juan", 15_000_000n],
    ]);
  });
});

describe("payers and participants of a shared expense (HU-E4-07, Review Focus 2)", () => {
  const paidBy = (memberId: string, accountId: string | null, pesos = 300_000n) => ({
    payments: [{ memberId, accountId, amount: cop(pesos) }],
  });

  it.each<[string, Partial<RecordExpenseInput>, string]>([
    ["a participant who is not a member", { split: equal("member-ana", "member-marta") }, "NotASpaceMember"],
    ["a payer who is not a member", paidBy("member-marta", null), "NotASpaceMember"],
    ["no participants", { split: equal() }, "ParticipantsRequired"],
    ["no payments", { payments: [] }, "PaymentsRequired"],
    ["a registered payer without an account", paidBy("member-juan", null), "AccountRequired"],
    ["a guest payer with an account", paidBy("member-pedro", ACCOUNTS.bancolombia.id), "GuestHasNoAccounts"],
    ["Juan paying from Ana's account", paidBy("member-juan", ACCOUNTS.bancolombia.id), "AccountNotOwned"],
    [
      "a payer listed twice",
      {
        payments: [
          { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(150_000n) },
          { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(150_000n) },
        ],
      },
      "InvalidSplit",
    ],
    [
      "payments that do not add up",
      paidBy("member-ana", ACCOUNTS.bancolombia.id, 200_000n),
      "SharesDoNotMatchAmount",
    ],
    [
      "a payment in another currency",
      {
        payments: [
          { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(100n, "USD") },
        ],
      },
      "CurrencyMismatch",
    ],
  ])("rejects %s and records nothing", async (_case, overrides, code) => {
    const { deps, store } = householdLedger();
    expect(codeOf(await createRecordExpense(deps)(groceries(300_000n, overrides)))).toBe(code);
    expect(store.rows).toEqual([]);
  });

  it("lets members record for guests, but not viewers, and hides the space from non-members", async () => {
    const { deps } = householdLedger();
    const record = createRecordExpense(deps);
    const byPedro = groceries(90_000n, {
      ...paidBy("member-pedro", null, 90_000n),
      split: equal("member-luis", "member-pedro"),
    });
    expect(codeOf(await record({ ...byPedro, userId: "u-luis" }))).toBe("ok");
    expect(codeOf(await record({ ...byPedro, userId: "u-sofi" }))).toBe("InsufficientRole");
    expect(codeOf(await record({ ...byPedro, userId: "u-marta" }))).toBe("SpaceNotFound");
  });
});
