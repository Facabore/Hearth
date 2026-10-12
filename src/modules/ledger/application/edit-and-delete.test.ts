import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money, unwrap } from "../../../../tests/support/fakes";
import { anExpense, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import type { Expense } from "../domain/transaction";
import { createDeleteTransaction } from "./delete-transaction";
import { createEditTransaction } from "./edit-transaction";
import { createListAudit } from "./list-audit";
import { createListTransactions } from "./list-transactions";

const household = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const luis = membership({ ...household, memberId: "member-luis", userId: "u-luis", role: "MEMBER" });
const asAna = { spaceId: "space-ana", userId: "u-ana" };

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
        changes: { amount: { from: "8500000", to: "9500000" } },
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

describe("DeleteTransaction (HU-E4-06)", () => {
  it("soft-deletes, hides the transaction and audits the deletion", async () => {
    const { remove, history, market, store, idsIn } = setup();
    unwrap(await remove({ ...asAna, transactionId: market.id }));
    expect(store.rows[0]?.deletedAt).not.toBeNull();
    expect(await idsIn("2026-10")).toEqual([]);
    const entries = unwrap(await history({ ...asAna, transactionId: market.id }));
    expect(entries.map((e) => [e.action, e.actorUserId])).toEqual([["DELETED", "u-ana"]]);
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
