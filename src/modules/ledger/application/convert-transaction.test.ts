import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  aSettlement,
  aTransfer,
  anExpense,
  anIncome,
  CATEGORIES,
  householdLedger,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import { createConvertTransaction } from "./convert-transaction";
import { createDeleteTransaction } from "./delete-transaction";
import { createListAudit } from "./list-audit";
import { createListTransactions } from "./list-transactions";
import { createRecordExpense } from "./record-expense";
import { createRecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome } from "./record-income";
import { createRecordTransfer } from "./record-transfer";
import { createUndoConversion } from "./undo-conversion";
import type { LedgerDeps } from "./deps";

const asAna = { spaceId: "space-ana", userId: "u-ana" };
const date = "2026-10-20" as LocalDate;

const converterOf = (deps: LedgerDeps) =>
  createConvertTransaction(deps, {
    recordExpense: createRecordExpense(deps),
    recordIncome: createRecordIncome(deps),
    recordTransfer: createRecordTransfer(deps),
    recordFundContribution: createRecordFundContribution(deps),
  });

const setup = (overrides: Partial<LedgerDeps> = {}) => {
  const state = { closed: new Set<string>() };
  const fixture = ledgerFixture({
    closedPeriods: { isClosed: async (_spaceId, day) => state.closed.has(day) },
    ...overrides,
  });
  const market = anExpense(date, 8_500_000n, { description: "Market" });
  fixture.store.rows.push(market);
  const list = createListTransactions(fixture.deps);
  return {
    ...fixture,
    state,
    market,
    convert: converterOf(fixture.deps),
    undo: createUndoConversion(fixture.deps),
    history: async (transactionId: string) =>
      unwrap(await createListAudit(fixture.deps)({ ...asAna, transactionId })),
    idsIn: async () =>
      unwrap(await list({ ...asAna, period: "2026-10", after: null, limit: 50 })).items.map((t) => t.id),
  };
};

const asIncome = {
  type: "INCOME" as const,
  description: "Refund",
  date,
  categoryId: CATEGORIES.salary.id,
  amount: money(8_500_000n),
  accountId: ACCOUNTS.bancolombia.id,
};

describe("ConvertTransaction (issue #195)", () => {
  it("turns an expense into an income: the income is recorded, the expense leaves, and both audits link", async () => {
    const { convert, history, idsIn, market, store, deps, locks } = setup();
    const income = unwrap(
      await convert({ ...asAna, transactionId: market.id, expectedVersion: 1, to: asIncome }),
    );
    expect(income).toMatchObject({
      type: "INCOME",
      description: "Refund",
      date,
      amount: 8_500_000n,
      destinationAccountId: ACCOUNTS.bancolombia.id,
      deletedAt: null,
    });
    expect(store.rows.find((t) => t.id === market.id)?.deletedAt).toEqual(deps.clock.now());
    expect(await idsIn()).toEqual([income.id]);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(8_500_000n);
    expect(locks.money[0]).toBe("space-ana");
    const original = await history(market.id);
    expect(original.map((e) => e.action)).toEqual(["DELETED"]);
    expect(original[0]!.changes).toMatchObject({
      convertedTo: { from: null, to: income.id },
      amount: { from: "8500000", to: null },
    });
    const converted = await history(income.id);
    expect(converted.map((e) => [e.action, e.actorUserId, e.changes])).toEqual([
      ["UPDATED", "u-ana", { convertedFrom: { from: null, to: market.id } }],
    ]);
  });

  it("turns an expense into a transfer, an income into an expense and a transfer into an expense", async () => {
    const { convert, store, market } = setup();
    const salary = anIncome(date, 300_000_000n);
    const move = aTransfer(date, 5_000_000n);
    store.rows.push(salary, move);
    const transfer = unwrap(
      await convert({
        ...asAna,
        transactionId: market.id,
        expectedVersion: null,
        to: {
          type: "TRANSFER",
          date,
          amount: money(8_500_000n),
          sourceAccountId: ACCOUNTS.bancolombia.id,
          destinationAccountId: ACCOUNTS.nequi.id,
        },
      }),
    );
    expect(transfer).toMatchObject({ type: "TRANSFER", sourceAccountId: ACCOUNTS.bancolombia.id });
    const expense = (amount: bigint) => ({
      type: "EXPENSE" as const,
      date,
      categoryId: CATEGORIES.groceries.id,
      amount: money(amount),
      accountId: ACCOUNTS.bancolombia.id,
    });
    expect(
      unwrap(
        await convert({ ...asAna, transactionId: salary.id, expectedVersion: 1, to: expense(300_000_000n) }),
      ),
    ).toMatchObject({ type: "EXPENSE", amount: 300_000_000n });
    expect(
      unwrap(
        await convert({ ...asAna, transactionId: move.id, expectedVersion: 1, to: expense(5_000_000n) }),
      ),
    ).toMatchObject({ type: "EXPENSE", amount: 5_000_000n });
    expect(store.rows.filter((t) => t.deletedAt === null).map((t) => t.type)).toEqual([
      "TRANSFER",
      "EXPENSE",
      "EXPENSE",
    ]);
  });

  it("refuses the same type, a settlement, a stale version and an unknown id, and changes nothing", async () => {
    const { convert, store, market } = setup();
    const settlement = aSettlement(date, 1_000_000n, { spaceId: "space-ana" });
    store.rows.push(settlement);
    const rows = structuredClone(store.rows);
    const answer = async (transactionId: string, expectedVersion: number | null, to: object) =>
      codeOf(await convert({ ...asAna, transactionId, expectedVersion, to: to as typeof asIncome }));
    const expense = { ...asIncome, type: "EXPENSE" };
    expect(await answer(market.id, 1, expense)).toBe("SameTransactionType");
    expect(await answer(settlement.id, 1, asIncome)).toBe("TransactionNotConvertible");
    expect(await answer(market.id, 2, asIncome)).toBe("PreconditionFailed");
    expect(await answer("tx-unknown", null, asIncome)).toBe("TransactionNotFound");
    expect(store.rows).toEqual(rows);
  });

  it("refuses a closed period on either date and an archived account (every guard of the record still applies)", async () => {
    const { convert, state, store, market } = setup();
    const rows = structuredClone(store.rows);
    state.closed.add(date);
    expect(
      codeOf(await convert({ ...asAna, transactionId: market.id, expectedVersion: 1, to: asIncome })),
    ).toBe("PeriodClosed");
    state.closed.clear();
    state.closed.add("2026-10-21");
    const later = { ...asIncome, date: "2026-10-21" as LocalDate };
    expect(codeOf(await convert({ ...asAna, transactionId: market.id, expectedVersion: 1, to: later }))).toBe(
      "PeriodClosed",
    );
    const archived = { ...asIncome, accountId: ACCOUNTS.oldNequi.id };
    expect(
      codeOf(await convert({ ...asAna, transactionId: market.id, expectedVersion: 1, to: archived })),
    ).toBe("AccountArchived");
    expect(store.rows).toEqual(rows);
  });

  it("in a shared space, turns an expense into a contribution to the fund and back (the owner's ruling)", async () => {
    const { deps, store } = householdLedger();
    const anas = anExpense(date, 6_000_000n, {
      spaceId: "space-household",
      categoryId: CATEGORIES.household.id,
      createdBy: "u-ana",
    });
    store.rows.push(anas);
    const convert = converterOf(deps);
    const asAnaHere = { spaceId: "space-household", userId: "u-ana" };
    const contribution = unwrap(
      await convert({
        ...asAnaHere,
        transactionId: anas.id,
        expectedVersion: 1,
        to: {
          type: "FUND_CONTRIBUTION",
          date,
          amount: money(6_000_000n),
          fundAccountId: ACCOUNTS.householdFund.id,
          sourceAccountId: ACCOUNTS.bancolombia.id,
        },
      }),
    );
    expect(contribution).toMatchObject({
      type: "TRANSFER",
      payerMemberId: "member-ana",
      sourceAccountId: ACCOUNTS.bancolombia.id,
      destinationAccountId: ACCOUNTS.householdFund.id,
    });
    expect(store.netOf(ACCOUNTS.householdFund.id)).toBe(6_000_000n);
    const again = {
      type: "FUND_CONTRIBUTION" as const,
      date,
      amount: money(6_000_000n),
      fundAccountId: ACCOUNTS.householdFund.id,
    };
    expect(
      codeOf(await convert({ ...asAnaHere, transactionId: contribution.id, expectedVersion: 1, to: again })),
    ).toBe("SameTransactionType");
    const expense = unwrap(
      await convert({
        ...asAnaHere,
        transactionId: contribution.id,
        expectedVersion: 1,
        to: {
          type: "EXPENSE",
          date,
          categoryId: CATEGORIES.household.id,
          amount: money(6_000_000n),
          payments: [
            { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(6_000_000n) },
          ],
        },
      }),
    );
    expect(expense).toMatchObject({ type: "EXPENSE", amount: 6_000_000n });
    expect(store.rows.filter((t) => t.deletedAt === null).map((t) => t.id)).toEqual([expense.id]);
  });

  it("applies the edit role rules in a shared space: a MEMBER converts only their own, a VIEWER none", async () => {
    const { deps, store } = householdLedger();
    const anas = anExpense(date, 6_000_000n, {
      spaceId: "space-household",
      categoryId: CATEGORIES.household.id,
      createdBy: "u-ana",
    });
    store.rows.push(anas);
    const convert = converterOf(deps);
    const to = {
      type: "TRANSFER" as const,
      date,
      amount: money(6_000_000n),
      sourceAccountId: ACCOUNTS.bancolombia.id,
      destinationAccountId: ACCOUNTS.nequi.id,
    };
    for (const userId of ["u-luis", "u-sofi"]) {
      expect(
        codeOf(
          await convert({
            spaceId: "space-household",
            userId,
            transactionId: anas.id,
            expectedVersion: 1,
            to,
          }),
        ),
      ).toBe("InsufficientRole");
    }
    expect(store.rows).toHaveLength(1);
  });
});

describe("UndoConversion (issue #195)", () => {
  it("restores the original and removes what it became, with mirrored audit entries", async () => {
    const { convert, undo, history, idsIn, market, store } = setup();
    const income = unwrap(
      await convert({ ...asAna, transactionId: market.id, expectedVersion: 1, to: asIncome }),
    );
    const restored = unwrap(await undo({ ...asAna, transactionId: market.id }));
    expect(restored).toMatchObject({ id: market.id, type: "EXPENSE", deletedAt: null, version: 3 });
    expect(await idsIn()).toEqual([market.id]);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-8_500_000n);
    expect((await history(market.id)).map((e) => [e.action, e.changes.convertedTo])).toEqual([
      ["DELETED", { from: null, to: income.id }],
      ["RESTORED", { from: income.id, to: null }],
    ]);
    expect((await history(income.id)).map((e) => [e.action, e.changes.convertedFrom])).toEqual([
      ["UPDATED", { from: null, to: market.id }],
      ["DELETED", { from: market.id, to: null }],
    ]);
  });

  it("answers a live original unchanged, so a second Deshacer changes nothing", async () => {
    const { convert, undo, store, market } = setup();
    unwrap(await convert({ ...asAna, transactionId: market.id, expectedVersion: 1, to: asIncome }));
    const first = unwrap(await undo({ ...asAna, transactionId: market.id }));
    const rows = structuredClone(store.rows);
    expect(unwrap(await undo({ ...asAna, transactionId: market.id }))).toEqual(first);
    expect(store.rows).toEqual(rows);
  });

  it("refuses a plain deletion, an unknown id and a closed period, and changes nothing", async () => {
    const { convert, undo, state, store, market, deps } = setup();
    const salary = anIncome(date, 300_000_000n);
    store.rows.push(salary);
    unwrap(await createDeleteTransaction(deps)({ ...asAna, transactionId: salary.id }));
    expect(codeOf(await undo({ ...asAna, transactionId: salary.id }))).toBe("TransactionNotConverted");
    expect(codeOf(await undo({ ...asAna, transactionId: "tx-unknown" }))).toBe("TransactionNotFound");
    unwrap(await convert({ ...asAna, transactionId: market.id, expectedVersion: 1, to: asIncome }));
    const rows = structuredClone(store.rows);
    state.closed.add(date);
    expect(codeOf(await undo({ ...asAna, transactionId: market.id }))).toBe("PeriodClosed");
    expect(store.rows).toEqual(rows);
  });
});
