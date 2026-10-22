import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { anExpense, householdLedger, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createDeleteTransaction } from "./delete-transaction";
import { createListAudit } from "./list-audit";
import { createListTransactions } from "./list-transactions";
import { createRestoreTransaction } from "./restore-transaction";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

const setup = () => {
  const state = { closed: false };
  const fixture = ledgerFixture({ closedPeriods: { isClosed: async () => state.closed } });
  const market = anExpense("2026-10-31", 8_500_000n, { description: "Market" });
  fixture.store.rows.push(market);
  const list = createListTransactions(fixture.deps);
  return {
    ...fixture,
    state,
    market,
    remove: createDeleteTransaction(fixture.deps),
    restore: createRestoreTransaction(fixture.deps),
    history: createListAudit(fixture.deps),
    idsIn: async () =>
      unwrap(await list({ ...asAna, period: "2026-10", after: null, limit: 50 })).items.map((t) => t.id),
  };
};

describe("RestoreTransaction (ruling P185)", () => {
  it("brings a deleted expense back to the list with the next version and audits the restore", async () => {
    const { remove, restore, history, idsIn, market, deps } = setup();
    unwrap(await remove({ ...asAna, transactionId: market.id }));
    expect(await idsIn()).toEqual([]);
    const restored = unwrap(await restore({ ...asAna, transactionId: market.id }));
    expect(restored).toMatchObject({ id: market.id, deletedAt: null, version: 3, amount: 8_500_000n });
    expect(await idsIn()).toEqual([market.id]);
    const entries = unwrap(await history({ ...asAna, transactionId: market.id }));
    expect(entries.map((e) => e.action)).toEqual(["DELETED", "RESTORED"]);
    expect(entries[1]).toMatchObject({
      actorUserId: "u-ana",
      at: deps.clock.now(),
      changes: expect.objectContaining({
        description: { from: null, to: "Market" },
        amount: { from: null, to: "8500000" },
        payments: {
          from: null,
          to: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]',
        },
      }),
    });
  });

  it("answers a transaction that is not deleted unchanged and writes no audit (a second Deshacer)", async () => {
    const { restore, history, market } = setup();
    expect(unwrap(await restore({ ...asAna, transactionId: market.id })).version).toBe(1);
    expect(unwrap(await history({ ...asAna, transactionId: market.id }))).toEqual([]);
  });

  it("restoring twice changes nothing: the second restore keeps the version, the row and the audit", async () => {
    const { remove, restore, history, store, market } = setup();
    unwrap(await remove({ ...asAna, transactionId: market.id }));
    const first = unwrap(await restore({ ...asAna, transactionId: market.id }));
    const rows = structuredClone(store.rows);
    const second = unwrap(await restore({ ...asAna, transactionId: market.id }));
    expect(second).toEqual(first);
    expect(store.rows).toEqual(rows);
    expect(unwrap(await history({ ...asAna, transactionId: market.id })).map((e) => e.action)).toEqual([
      "DELETED",
      "RESTORED",
    ]);
  });

  it("refuses an unknown id and a closed period, as deleting does (HU-E4-06)", async () => {
    const { remove, restore, state, market, store } = setup();
    expect(codeOf(await restore({ ...asAna, transactionId: "tx-unknown" }))).toBe("TransactionNotFound");
    unwrap(await remove({ ...asAna, transactionId: market.id }));
    state.closed = true;
    expect(codeOf(await restore({ ...asAna, transactionId: market.id }))).toBe("PeriodClosed");
    expect(store.rows[0]!.deletedAt).not.toBeNull();
  });

  it("lets OWNER and ADMIN restore any transaction, a MEMBER only their own, a VIEWER none", async () => {
    const { deps, store } = householdLedger();
    const deleted = anExpense("2026-10-20", 3_000_000n, {
      spaceId: "space-household",
      deletedAt: new Date("2026-10-27T12:00:00Z"),
      version: 2,
    });
    store.rows.push(deleted);
    const restore = createRestoreTransaction(deps);
    const as = (userId: string) => restore({ spaceId: "space-household", userId, transactionId: deleted.id });
    expect(codeOf(await as("u-luis"))).toBe("InsufficientRole");
    expect(codeOf(await as("u-sofi"))).toBe("InsufficientRole");
    expect(store.rows[0]!.deletedAt).not.toBeNull();
    expect(unwrap(await as("u-juan")).deletedAt).toBeNull();
  });

  it("keeps a member who left at their settled zero: their deleted expense stays deleted (Task 4b)", async () => {
    const { deps, store } = householdLedger();
    const withGone = anExpense("2026-10-20", 3_000_000n, {
      spaceId: "space-household",
      shares: [
        { memberId: "member-ana", amount: 1_500_000n, splitMethod: "EQUAL" },
        { memberId: "member-gone", amount: 1_500_000n, splitMethod: "EQUAL" },
      ],
      deletedAt: new Date("2026-10-27T12:00:00Z"),
      version: 2,
    });
    store.rows.push(withGone);
    const result = await createRestoreTransaction(deps)({
      spaceId: "space-household",
      userId: "u-ana",
      transactionId: withGone.id,
    });
    expect(codeOf(result)).toBe("NotASpaceMember");
    expect(store.rows[0]!.deletedAt).not.toBeNull();
  });
});
