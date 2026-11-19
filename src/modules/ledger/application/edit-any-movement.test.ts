import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  aSettlement,
  aTransfer,
  anExpense,
  anIncome,
  householdLedger,
} from "../../../../tests/support/in-memory-ledger";
import type { Expense, Income, Settlement, Transaction, Transfer } from "../domain/transaction";
import { createDeleteTransaction } from "./delete-transaction";
import { createEditTransaction, type EditChanges } from "./edit-transaction";
import { createListAudit } from "./list-audit";
import type { LedgerAccount } from "./ports";
import { createRestoreTransaction } from "./restore-transaction";

/** Luis (MEMBER) and Juan's second account, which the shared fixture does not have. */
const LUIS_BANK: LedgerAccount = {
  id: "acc-luis",
  spaceId: "space-luis",
  ownerUserId: "u-luis",
  isSharedFund: false,
  archived: false,
  currency: "COP",
};
const JUAN_CASH: LedgerAccount = {
  ...LUIS_BANK,
  id: "acc-juan-cash",
  spaceId: "space-juan",
  ownerUserId: "u-juan",
};
const accounts = {
  find: async (id: string) =>
    [...Object.values(ACCOUNTS), LUIS_BANK, JUAN_CASH].find((a) => a.id === id) ?? null,
};

const inHousehold = { spaceId: "space-household" } as const;

/**
 * Household (OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi, the guest Pedro) with movements Juan recorded: an expense
 * he paid from Davivienda, the settlement "Ana paid Juan" with no account (the staging case of P344), a contribution
 * of his to the fund and an own transfer of his.
 */
const world = () => {
  const fixture = householdLedger(undefined, { accounts });
  const juans = anExpense("2026-10-21", 1_000_000n, {
    ...inHousehold,
    createdBy: "u-juan",
    payments: [{ memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: 1_000_000n }],
    shares: [{ memberId: "member-juan", amount: 1_000_000n, splitMethod: "EQUAL" }],
  });
  const settlement = aSettlement("2026-10-22", 2_900_000n, {
    createdBy: "u-juan",
    payerMemberId: "member-ana",
    receivingMemberId: "member-juan",
  });
  const contribution = aTransfer("2026-10-23", 500_000n, {
    ...inHousehold,
    createdBy: "u-juan",
    payerMemberId: "member-juan",
    sourceAccountId: ACCOUNTS.davivienda.id,
    destinationAccountId: ACCOUNTS.householdFund.id,
  });
  const move = aTransfer("2026-10-24", 300_000n, {
    ...inHousehold,
    createdBy: "u-juan",
    sourceAccountId: ACCOUNTS.davivienda.id,
    destinationAccountId: JUAN_CASH.id,
  });
  const salary = anIncome("2026-10-25", 4_000_000n, {
    ...inHousehold,
    createdBy: "u-juan",
    receivingMemberId: "member-juan",
    destinationAccountId: ACCOUNTS.davivienda.id,
  });
  fixture.store.rows.push(juans, settlement, contribution, move, salary);
  const edit = createEditTransaction(fixture.deps);
  const history = createListAudit(fixture.deps);
  return {
    ...fixture,
    juans,
    settlement,
    contribution,
    move,
    salary,
    change: (userId: string, transactionId: string, changes: EditChanges) =>
      edit({ ...inHousehold, userId, transactionId, expectedVersion: null, changes }),
    historyOf: async (transactionId: string) =>
      unwrap(await history({ ...inHousehold, userId: "u-ana", transactionId })),
    rowOf: (id: string) => fixture.store.rows.find((t) => t.id === id) as Transaction,
  };
};

describe("P344 (S1): any member who records money corrects any movement of the space", () => {
  it("lets a MEMBER change the amount of an expense Juan recorded and paid, and audits Luis as the actor", async () => {
    const { change, historyOf, juans, rowOf, store } = world();
    const edited = unwrap(await change("u-luis", juans.id, { amount: money(1_200_000n) })) as Expense;
    expect(edited.payments).toEqual([
      { memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: 1_200_000n },
    ]);
    expect(rowOf(juans.id)).toMatchObject({ amount: 1_200_000n, version: 2 });
    // S3: the debit on Juan's account moves with the correction, and the audit says so.
    expect(store.netOf(ACCOUNTS.davivienda.id)).toBe(-1_200_000n + 4_000_000n - 500_000n - 300_000n);
    const [entry] = await historyOf(juans.id);
    expect([entry!.action, entry!.actorUserId, entry!.changes.amount]).toEqual([
      "UPDATED",
      "u-luis",
      { from: "1000000", to: "1200000" },
    ]);
  });

  it("lets a MEMBER correct every type someone else recorded: income, own transfer, contribution and settlement", async () => {
    const { change, contribution, move, rowOf, salary, settlement } = world();
    for (const tx of [salary, move, contribution, settlement]) {
      expect(unwrap(await change("u-luis", tx.id, { amount: money(100_000n) })).amount).toBe(100_000n);
      expect(rowOf(tx.id).version).toBe(2);
    }
  });

  it("keeps a VIEWER out of every movement, and changes nothing", async () => {
    const { audit, change, juans, rowOf } = world();
    expect(codeOf(await change("u-sofi", juans.id, { description: "Mine" }))).toBe("InsufficientRole");
    expect(rowOf(juans.id)).toEqual(juans);
    expect(audit.entries).toEqual([]);
  });

  it("lets a MEMBER delete and restore a movement someone else recorded, as an edit (P344 keeps them aligned)", async () => {
    const { audit, deps, juans, rowOf } = world();
    unwrap(
      await createDeleteTransaction(deps)({ ...inHousehold, userId: "u-luis", transactionId: juans.id }),
    );
    expect(rowOf(juans.id).deletedAt).not.toBeNull();
    unwrap(
      await createRestoreTransaction(deps)({ ...inHousehold, userId: "u-luis", transactionId: juans.id }),
    );
    expect(rowOf(juans.id).deletedAt).toBeNull();
    expect(audit.entries.map((e) => [e.action, e.actorUserId])).toEqual([
      ["DELETED", "u-luis"],
      ["RESTORED", "u-luis"],
    ]);
    expect(
      codeOf(
        await createDeleteTransaction(deps)({ ...inHousehold, userId: "u-sofi", transactionId: juans.id }),
      ),
    ).toBe("InsufficientRole");
  });
});

describe("P344 (S2, S3): an expense's payments name the editor's own accounts, and only members for the others", () => {
  it("keeps Juan's account on his payment when an OWNER splits who paid", async () => {
    const { change, historyOf, juans, rowOf } = world();
    const edited = unwrap(
      await change("u-ana", juans.id, {
        payments: [
          { memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: money(600_000n) },
          { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(400_000n) },
        ],
      }),
    ) as Expense;
    const expected = [
      { memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: 600_000n },
      { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: 400_000n },
    ];
    expect(edited.payments).toEqual(expected);
    expect((rowOf(juans.id) as Expense).payments).toEqual(expected);
    const [entry] = await historyOf(juans.id);
    expect(entry!.actorUserId).toBe("u-ana");
    expect(JSON.parse(entry!.changes.payments!.to!)).toEqual(
      expected.map((p) => ({ ...p, amount: String(p.amount) })),
    );
  });

  it("moves Juan's payment to Luis with no account: the editor chooses only the member", async () => {
    const { change, juans, rowOf, store } = world();
    const before = store.netOf(ACCOUNTS.davivienda.id);
    unwrap(
      await change("u-ana", juans.id, {
        payments: [{ memberId: "member-luis", accountId: null, amount: money(1_000_000n) }],
      }),
    );
    expect((rowOf(juans.id) as Expense).payments).toEqual([
      { memberId: "member-luis", accountId: null, amount: 1_000_000n },
    ]);
    expect(store.netOf(ACCOUNTS.davivienda.id)).toBe(before + 1_000_000n);
  });

  it("refuses naming an account the editor does not own on another member's payment, and changes nothing", async () => {
    const { audit, change, juans, rowOf } = world();
    const paidBy = (memberId: string, accountId: string) => ({
      payments: [{ memberId, accountId, amount: money(1_000_000n) }],
    });
    expect(codeOf(await change("u-ana", juans.id, paidBy("member-juan", LUIS_BANK.id)))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await change("u-ana", juans.id, paidBy("member-juan", JUAN_CASH.id)))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await change("u-ana", juans.id, paidBy("member-luis", ACCOUNTS.davivienda.id)))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await change("u-ana", juans.id, paidBy("member-pedro", ACCOUNTS.bancolombia.id)))).toBe(
      "GuestHasNoAccounts",
    );
    expect(rowOf(juans.id)).toEqual(juans);
    expect(audit.entries).toEqual([]);
  });

  it("lets the editor take the payment with an account of their own, or with none", async () => {
    const { change, juans, rowOf } = world();
    unwrap(await change("u-ana", juans.id, { accountId: ACCOUNTS.bancolombia.id }));
    expect((rowOf(juans.id) as Expense).payments).toEqual([
      { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: 1_000_000n },
    ]);
    unwrap(
      await change("u-ana", juans.id, {
        payments: [{ memberId: "member-ana", accountId: null, amount: money(1_000_000n) }],
      }),
    );
    expect((rowOf(juans.id) as Expense).payments).toEqual([
      { memberId: "member-ana", accountId: null, amount: 1_000_000n },
    ]);
  });
});

describe("P344 (S2–S4): a settlement's members and accounts", () => {
  it("lets the payer attach an account of their own to a settlement someone else recorded, and audits it", async () => {
    const { change, historyOf, rowOf, settlement, store } = world();
    const edited = unwrap(
      await change("u-ana", settlement.id, { sourceAccountId: ACCOUNTS.bancolombia.id }),
    ) as Settlement;
    expect(edited.sourceAccountId).toBe(ACCOUNTS.bancolombia.id);
    expect(rowOf(settlement.id)).toMatchObject({ sourceAccountId: ACCOUNTS.bancolombia.id, version: 2 });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-2_900_000n);
    const [entry] = await historyOf(settlement.id);
    expect([entry!.actorUserId, entry!.changes]).toEqual([
      "u-ana",
      { sourceAccountId: { from: null, to: ACCOUNTS.bancolombia.id } },
    ]);
  });

  it("lets the receiver attach theirs, and refuses an account on a side that is not the editor's", async () => {
    const { audit, change, rowOf, settlement } = world();
    expect(
      codeOf(await change("u-luis", settlement.id, { destinationAccountId: ACCOUNTS.davivienda.id })),
    ).toBe("AccountNotOwned");
    expect(codeOf(await change("u-luis", settlement.id, { sourceAccountId: LUIS_BANK.id }))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await change("u-juan", settlement.id, { sourceAccountId: ACCOUNTS.davivienda.id }))).toBe(
      "AccountNotOwned",
    );
    expect(audit.entries).toEqual([]);
    unwrap(await change("u-juan", settlement.id, { destinationAccountId: JUAN_CASH.id }));
    expect(rowOf(settlement.id)).toMatchObject({ sourceAccountId: null, destinationAccountId: JUAN_CASH.id });
    // The editor's own side may also go back to none.
    unwrap(await change("u-juan", settlement.id, { destinationAccountId: null }));
    expect((rowOf(settlement.id) as Settlement).destinationAccountId).toBeNull();
  });

  it("moves a side to another current member, who keeps no account; an unchanged side keeps its own", async () => {
    const { change, historyOf, rowOf, settlement, store } = world();
    unwrap(await change("u-ana", settlement.id, { sourceAccountId: ACCOUNTS.bancolombia.id }));
    unwrap(await change("u-juan", settlement.id, { destinationAccountId: ACCOUNTS.davivienda.id }));
    // Luis says he was the one who paid Juan, from his own account.
    unwrap(
      await change("u-luis", settlement.id, { payerMemberId: "member-luis", sourceAccountId: LUIS_BANK.id }),
    );
    expect(rowOf(settlement.id)).toMatchObject({
      payerMemberId: "member-luis",
      sourceAccountId: LUIS_BANK.id,
      receivingMemberId: "member-juan",
      destinationAccountId: ACCOUNTS.davivienda.id,
    });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(0n);
    // Then Ana says the money reached the guest Pedro, not Juan: Juan's account leaves with him.
    unwrap(await change("u-ana", settlement.id, { receivingMemberId: "member-pedro" }));
    expect(rowOf(settlement.id)).toMatchObject({
      payerMemberId: "member-luis",
      sourceAccountId: LUIS_BANK.id,
      receivingMemberId: "member-pedro",
      destinationAccountId: null,
      version: 5,
    });
    const entries = await historyOf(settlement.id);
    expect(entries.map((e) => [e.actorUserId, e.changes])).toEqual([
      ["u-ana", { sourceAccountId: { from: null, to: ACCOUNTS.bancolombia.id } }],
      ["u-juan", { destinationAccountId: { from: null, to: ACCOUNTS.davivienda.id } }],
      [
        "u-luis",
        {
          payerMemberId: { from: "member-ana", to: "member-luis" },
          sourceAccountId: { from: ACCOUNTS.bancolombia.id, to: LUIS_BANK.id },
        },
      ],
      [
        "u-ana",
        {
          receivingMemberId: { from: "member-juan", to: "member-pedro" },
          destinationAccountId: { from: ACCOUNTS.davivienda.id, to: null },
        },
      ],
    ]);
  });

  it("keeps the members distinct and current, a guest without accounts, and a third member out of the parties", async () => {
    const { audit, change, settlement, store } = world();
    expect(codeOf(await change("u-ana", settlement.id, { payerMemberId: "member-juan" }))).toBe(
      "InvalidSettlementParties",
    );
    expect(codeOf(await change("u-ana", settlement.id, { receivingMemberId: "member-gone" }))).toBe(
      "NotASpaceMember",
    );
    expect(
      codeOf(
        await change("u-ana", settlement.id, {
          receivingMemberId: "member-pedro",
          destinationAccountId: ACCOUNTS.bancolombia.id,
        }),
      ),
    ).toBe("GuestHasNoAccounts");
    const forLuis = aSettlement("2026-10-22", 100_000n, { onBehalfOfMemberId: "member-luis" });
    store.rows.push(forLuis);
    expect(codeOf(await change("u-ana", forLuis.id, { payerMemberId: "member-luis" }))).toBe(
      "InvalidOnBehalfOf",
    );
    expect(audit.entries).toEqual([]);
  });

  it("keeps a forgiveness without accounts, and a gift's halves with their members and accounts (P322)", async () => {
    const { change, store } = world();
    const forgiven = aSettlement("2026-10-22", 100_000n, { reason: "FORGIVENESS" });
    const gift = aSettlement("2026-10-22", 100_000n, {
      reason: "GIFT",
      linkedTransactionId: "tx-paid" as never,
    });
    store.rows.push(forgiven, gift);
    expect(
      codeOf(await change("u-ana", forgiven.id, { destinationAccountId: ACCOUNTS.bancolombia.id })),
    ).toBe("ForgivenessHasNoAccounts");
    for (const changes of [
      { payerMemberId: "member-luis" },
      { receivingMemberId: "member-luis" },
      { sourceAccountId: ACCOUNTS.davivienda.id },
    ]) {
      const result = await change("u-juan", gift.id, changes);
      expect(result.ok ? null : [result.error.code, result.error.details?.field]).toEqual([
        "FieldNotEditable",
        Object.keys(changes)[0],
      ]);
    }
  });
});

describe("P344 (S2–S4): a fund contribution's payer", () => {
  it("moves the contribution to Luis with no account, then lets Luis name his own; the fund stays", async () => {
    const { change, contribution, historyOf, rowOf, store } = world();
    unwrap(await change("u-ana", contribution.id, { payerMemberId: "member-luis" }));
    expect(rowOf(contribution.id)).toMatchObject({ payerMemberId: "member-luis", sourceAccountId: null });
    expect(store.netOf(ACCOUNTS.davivienda.id)).toBe(4_000_000n - 1_000_000n - 300_000n);
    unwrap(await change("u-luis", contribution.id, { sourceAccountId: LUIS_BANK.id }));
    expect((rowOf(contribution.id) as Transfer).sourceAccountId).toBe(LUIS_BANK.id);
    expect((await historyOf(contribution.id)).map((e) => [e.actorUserId, e.changes])).toEqual([
      [
        "u-ana",
        {
          payerMemberId: { from: "member-juan", to: "member-luis" },
          sourceAccountId: { from: ACCOUNTS.davivienda.id, to: null },
        },
      ],
      ["u-luis", { sourceAccountId: { from: null, to: LUIS_BANK.id } }],
    ]);
    const fund = await change("u-luis", contribution.id, { destinationAccountId: ACCOUNTS.oldFund.id });
    expect(fund.ok ? null : [fund.error.code, fund.error.details?.field]).toEqual([
      "FieldNotEditable",
      "destinationAccountId",
    ]);
  });

  it("refuses another member's account and a member who is not current", async () => {
    const { audit, change, contribution } = world();
    expect(codeOf(await change("u-ana", contribution.id, { sourceAccountId: ACCOUNTS.bancolombia.id }))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await change("u-ana", contribution.id, { payerMemberId: "member-gone" }))).toBe(
      "NotASpaceMember",
    );
    expect(audit.entries).toEqual([]);
  });
});

describe("P344 (S2, S3): an income's and an own transfer's accounts stay their member's", () => {
  it("lets Luis correct the amount of Juan's income and transfer, never point them at his account", async () => {
    const { change, move, rowOf, salary } = world();
    expect(codeOf(await change("u-luis", salary.id, { accountId: LUIS_BANK.id }))).toBe("AccountNotOwned");
    expect(codeOf(await change("u-luis", move.id, { sourceAccountId: LUIS_BANK.id }))).toBe(
      "AccountNotOwned",
    );
    // Echoing the account the movement already has changes nothing and is not refused.
    unwrap(
      await change("u-luis", salary.id, { accountId: ACCOUNTS.davivienda.id, amount: money(4_500_000n) }),
    );
    expect(rowOf(salary.id) as Income).toMatchObject({
      destinationAccountId: ACCOUNTS.davivienda.id,
      amount: 4_500_000n,
    });
  });
});

describe("P344 (S7): the audit names the actor in the space", () => {
  it("answers each entry with its actor's display name, or null for someone who is not a member any more", async () => {
    const { audit, change, historyOf, juans } = world();
    unwrap(await change("u-luis", juans.id, { description: "Market" }));
    await audit.append({
      id: "audit-gone",
      transactionId: juans.id,
      action: "UPDATED",
      actorUserId: "u-gone",
      at: new Date("2026-10-28T16:00:00Z"),
      changes: { description: { from: "Market", to: "Old" } },
    });
    expect((await historyOf(juans.id)).map((e) => [e.actorUserId, e.actorName])).toEqual([
      ["u-luis", "Luis"],
      ["u-gone", null],
    ]);
  });
});
