import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  aSettlement,
  aTransfer,
  anExpense,
  CATEGORIES,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import type { Expense } from "../domain/transaction";
import { createDeleteTransaction } from "./delete-transaction";
import { createEditTransaction, type EditChanges } from "./edit-transaction";
import { createListAudit } from "./list-audit";
import { createListTransactions } from "./list-transactions";

const household = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const luis = membership({ ...household, memberId: "member-luis", userId: "u-luis", role: "MEMBER" });
const asAna = { spaceId: "space-ana", userId: "u-ana" };
/** Household's current members as the ledger reads them: Ana and Juan; Luis is not one of them (Task 4b). */
const currentHousehold = {
  listCurrent: async () => [memberOf("Ana", "OWNER", 0), memberOf("Juan", "MEMBER", 1)],
};

const setup = (closed: (date: LocalDate) => boolean = () => false) => {
  const fixture = ledgerFixture({
    access: fakeSpaceAccess(membership(), household, luis),
    closedPeriods: { isClosed: async (_spaceId, date) => closed(date) },
  });
  const market = anExpense("2026-10-31", 8_500_000n, { description: "Market" });
  fixture.store.rows.push(market);
  const list = createListTransactions(fixture.deps);
  return {
    ...fixture,
    market,
    edit: createEditTransaction(fixture.deps),
    remove: createDeleteTransaction(fixture.deps),
    history: createListAudit(fixture.deps),
    idsIn: async (period: string) =>
      unwrap(await list({ ...asAna, period, after: null, limit: 50 })).items.map((t) => t.id),
  };
};

describe("EditTransaction (HU-E4-06)", () => {
  it("changes the amount with one payment and one share and audits who changed what", async () => {
    const { edit, history, market, deps } = setup();
    const edited = unwrap(
      await edit({
        ...asAna,
        transactionId: market.id,
        expectedVersion: 1,
        changes: { amount: money(9_500_000n) },
      }),
    ) as Expense;
    expect(edited).toMatchObject({ amount: 9_500_000n, version: 2 });
    expect(edited.payments.map((p) => p.amount)).toEqual([9_500_000n]);
    expect(edited.shares.map((s) => s.amount)).toEqual([9_500_000n]);
    expect(unwrap(await history({ ...asAna, transactionId: market.id }))).toEqual([
      {
        id: expect.any(String),
        transactionId: market.id,
        action: "UPDATED",
        actorUserId: "u-ana",
        at: deps.clock.now(),
        // D8 (Task 0b): the sole payment and share followed the amount; the audit keeps both versions.
        changes: {
          amount: { from: "8500000", to: "9500000" },
          payments: {
            from: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]',
            to: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"9500000"}]',
          },
          shares: {
            from: '[{"memberId":"member-ana","amount":"8500000","splitMethod":"EQUAL"}]',
            to: '[{"memberId":"member-ana","amount":"9500000","splitMethod":"EQUAL"}]',
          },
        },
      },
    ]);
  });

  it("rejects an amount that breaks the shares of a shared expense", async () => {
    const { store, edit } = setup();
    const shared = anExpense("2026-10-20", 30_000_000n, {
      spaceId: "space-household",
      shares: [
        { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
      ],
    });
    store.rows.push(shared);
    const result = await edit({
      spaceId: "space-household",
      userId: "u-ana",
      transactionId: shared.id,
      expectedVersion: null,
      changes: { amount: money(32_000_000n) },
    });
    expect(codeOf(result)).toBe("SharesDoNotMatchAmount");
  });

  it("forbids members from editing another member's transaction", async () => {
    const { store, edit } = setup();
    const anas = anExpense("2026-10-20", 5_000_000n, { spaceId: "space-household" });
    store.rows.push(anas);
    const result = await edit({
      spaceId: "space-household",
      userId: "u-luis",
      transactionId: anas.id,
      expectedVersion: null,
      changes: { description: "Mine" },
    });
    expect(codeOf(result)).toBe("InsufficientRole");
  });

  it("rejects changes inside a closed period and moves into one", async () => {
    const novemberClosed = setup((date) => date.startsWith("2026-11"));
    const move = await novemberClosed.edit({
      ...asAna,
      transactionId: novemberClosed.market.id,
      expectedVersion: null,
      changes: { date: "2026-11-02" as LocalDate },
    });
    expect(codeOf(move)).toBe("PeriodClosed");
    const octoberClosed = setup((date) => date.startsWith("2026-10"));
    const touch = await octoberClosed.edit({
      ...asAna,
      transactionId: octoberClosed.market.id,
      expectedVersion: null,
      changes: { description: "Groceries" },
    });
    expect(codeOf(touch)).toBe("PeriodClosed");
  });

  it("rejects a stale version and changes nothing (Review Focus 1)", async () => {
    const { edit, market, store, audit } = setup();
    unwrap(
      await edit({
        ...asAna,
        transactionId: market.id,
        expectedVersion: 1,
        changes: { description: "Groceries" },
      }),
    );
    const stale = await edit({
      ...asAna,
      transactionId: market.id,
      expectedVersion: 1,
      changes: { amount: money(1_000n) },
    });
    expect(codeOf(stale)).toBe("PreconditionFailed");
    expect(store.rows[0]).toMatchObject({ amount: 8_500_000n, description: "Groceries", version: 2 });
    expect(audit.entries).toHaveLength(1);
  });

  it("moves the transaction to another period when its date changes (HU-E4-04)", async () => {
    const { edit, market, idsIn } = setup();
    unwrap(
      await edit({
        ...asAna,
        transactionId: market.id,
        expectedVersion: null,
        changes: { date: "2026-11-02" as LocalDate },
      }),
    );
    expect(await idsIn("2026-11")).toEqual([market.id]);
    expect(await idsIn("2026-10")).toEqual([]);
  });

  it("rejects archived categories and other currencies", async () => {
    const { edit, market } = setup();
    const base = { ...asAna, transactionId: market.id, expectedVersion: null };
    expect(codeOf(await edit({ ...base, changes: { categoryId: CATEGORIES.archived.id } }))).toBe(
      "CategoryArchived",
    );
    expect(codeOf(await edit({ ...base, changes: { amount: money(100n, "USD") } }))).toBe("CurrencyMismatch");
  });

  it("writes nothing for an edit that changes nothing", async () => {
    const { edit, market, audit } = setup();
    const same = unwrap(
      await edit({
        ...asAna,
        transactionId: market.id,
        expectedVersion: 1,
        changes: { description: "Market" },
      }),
    );
    expect(same.version).toBe(1);
    expect(audit.entries).toEqual([]);
  });
});

describe("EditTransaction keeps personal accounts debited only by their owner (D9)", () => {
  const juan = membership({ ...household, memberId: "member-juan", userId: "u-juan", role: "MEMBER" });
  const inHousehold = { spaceId: "space-household", createdBy: "u-juan" };
  // Juan's own records from his Davivienda: an expense he paid for Ana, a contribution and a settlement.
  const juansExpense = anExpense("2026-10-20", 5_000_000n, {
    ...inHousehold,
    categoryId: CATEGORIES.household.id,
    payments: [{ memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: 5_000_000n }],
    shares: [{ memberId: "member-ana", amount: 5_000_000n, splitMethod: "EQUAL" }],
  });
  const juansContribution = aTransfer("2026-10-20", 5_000_000n, {
    ...inHousehold,
    sourceAccountId: ACCOUNTS.davivienda.id,
    destinationAccountId: ACCOUNTS.householdFund.id,
    payerMemberId: "member-juan",
  });
  const juansSettlement = aSettlement("2026-10-20", 5_000_000n, {
    createdBy: "u-juan",
    sourceAccountId: ACCOUNTS.davivienda.id,
  });
  const fundPaid = anExpense("2026-10-20", 5_000_000n, {
    ...inHousehold,
    categoryId: CATEGORIES.household.id,
    payments: [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount: 5_000_000n }],
  });
  const setupHousehold = () => {
    // Task 4b: amount edits check that the parties are current members, so the ledger needs Household's.
    const fixture = ledgerFixture({ access: fakeSpaceAccess(household, juan), members: currentHousehold });
    fixture.store.rows.push(juansExpense, juansContribution, juansSettlement, fundPaid);
    return { ...fixture, edit: createEditTransaction(fixture.deps) };
  };
  const editAs = (userId: string, transactionId: string, changes: EditChanges) =>
    ({ spaceId: "space-household", userId, transactionId, expectedVersion: null, changes }) as const;

  it.each([
    ["expense payment", juansExpense],
    ["fund contribution source", juansContribution],
    ["settlement source", juansSettlement],
  ])("refuses the OWNER changing the amount of Juan's %s and changes nothing", async (_, tx) => {
    const { edit, store, audit } = setupHousehold();
    const result = await edit(editAs("u-ana", tx.id, { amount: money(9_000_000n) }));
    expect(codeOf(result)).toBe("AccountNotOwned");
    expect(store.rows.find((t) => t.id === tx.id)).toEqual(tx);
    expect(store.netOf(ACCOUNTS.davivienda.id)).toBe(-15_000_000n);
    expect(audit.entries).toEqual([]);
  });

  it("still lets the OWNER correct the description, category and date of Juan's expense (money.editAny)", async () => {
    const { edit } = setupHousehold();
    const changes = { description: "Rent", date: "2026-10-21" as LocalDate };
    expect(unwrap(await edit(editAs("u-ana", juansExpense.id, changes)))).toMatchObject({
      ...changes,
      amount: 5_000_000n,
      version: 2,
    });
  });

  it("lets Juan change the amounts he debited from his own account", async () => {
    const { edit, store } = setupHousehold();
    for (const tx of [juansExpense, juansContribution, juansSettlement]) {
      unwrap(await edit(editAs("u-juan", tx.id, { amount: money(6_000_000n) })));
    }
    expect(store.netOf(ACCOUNTS.davivienda.id)).toBe(-18_000_000n);
  });

  it("lets the OWNER change the amount of an expense paid from the shared fund", async () => {
    const { edit } = setupHousehold();
    const edited = unwrap(await edit(editAs("u-ana", fundPaid.id, { amount: money(6_000_000n) })));
    expect(edited.amount).toBe(6_000_000n);
  });
});

describe("DeleteTransaction (HU-E4-06)", () => {
  it("soft-deletes, hides the transaction and audits the deletion", async () => {
    const { remove, history, market, store, idsIn } = setup();
    unwrap(await remove({ ...asAna, transactionId: market.id }));
    expect(store.rows[0]?.deletedAt).not.toBeNull();
    expect(await idsIn("2026-10")).toEqual([]);
    const entries = unwrap(await history({ ...asAna, transactionId: market.id }));
    expect(entries.map((e) => [e.action, e.actorUserId])).toEqual([["DELETED", "u-ana"]]);
    // D8 (Task 0b): the deletion keeps the whole last version, payments and shares included.
    expect(entries[0]?.changes).toEqual({
      description: { from: "Market", to: null },
      date: { from: "2026-10-31", to: null },
      categoryId: { from: CATEGORIES.groceries.id, to: null },
      amount: { from: "8500000", to: null },
      payments: {
        from: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]',
        to: null,
      },
      shares: { from: '[{"memberId":"member-ana","amount":"8500000","splitMethod":"EQUAL"}]', to: null },
    });
    expect(codeOf(await remove({ ...asAna, transactionId: market.id }))).toBe("TransactionNotFound");
  });

  it("forbids members from deleting another member's transaction", async () => {
    const { store, remove } = setup();
    const anas = anExpense("2026-10-20", 5_000_000n, { spaceId: "space-household" });
    store.rows.push(anas);
    expect(
      codeOf(await remove({ spaceId: "space-household", userId: "u-luis", transactionId: anas.id })),
    ).toBe("InsufficientRole");
  });
});

describe("edits and deletes never move a former member's balance (HU-E1-08, HU-E1-12, Task 4b)", () => {
  // Luis left Household after settling: Ana paid him back for an expense he paid outside the app.
  const settledWithLuis = aSettlement("2026-10-20", 5_000_000n, {
    payerMemberId: "member-ana",
    receivingMemberId: "member-luis",
  });
  const luisPaid = anExpense("2026-10-05", 5_000_000n, {
    spaceId: "space-household",
    categoryId: CATEGORIES.household.id,
    payments: [{ memberId: "member-luis", accountId: null, amount: 5_000_000n }],
    shares: [{ memberId: "member-ana", amount: 5_000_000n, splitMethod: "EQUAL" }],
  });
  const setupWithoutLuis = () => {
    const fixture = ledgerFixture({ access: fakeSpaceAccess(household), members: currentHousehold });
    fixture.store.rows.push(settledWithLuis, luisPaid);
    return {
      ...fixture,
      edit: createEditTransaction(fixture.deps),
      remove: createDeleteTransaction(fixture.deps),
    };
  };
  const onHousehold = (transactionId: string) => ({
    spaceId: "space-household",
    userId: "u-ana",
    transactionId,
  });

  it.each([
    ["the settlement Luis received", settledWithLuis],
    ["the expense Luis paid", luisPaid],
  ])("refuses a new amount for %s and changes nothing", async (_, tx) => {
    const { edit, store, audit } = setupWithoutLuis();
    const changes = { amount: money(6_000_000n) };
    expect(codeOf(await edit({ ...onHousehold(tx.id), expectedVersion: null, changes }))).toBe(
      "NotASpaceMember",
    );
    expect(store.rows.find((t) => t.id === tx.id)).toEqual(tx);
    expect(audit.entries).toEqual([]);
  });

  it("refuses deleting them", async () => {
    const { remove, store, audit } = setupWithoutLuis();
    for (const tx of [settledWithLuis, luisPaid]) {
      expect(codeOf(await remove(onHousehold(tx.id)))).toBe("NotASpaceMember");
    }
    expect(store.rows.map((t) => t.deletedAt)).toEqual([null, null]);
    expect(audit.entries).toEqual([]);
  });

  it("still lets the OWNER correct what moves no balance: description, date and category", async () => {
    const { edit } = setupWithoutLuis();
    const changes = { description: "Paid back Luis", date: "2026-10-21" as LocalDate };
    expect(
      unwrap(await edit({ ...onHousehold(settledWithLuis.id), expectedVersion: null, changes })),
    ).toMatchObject({ ...changes, amount: 5_000_000n, version: 2 });
  });
});
