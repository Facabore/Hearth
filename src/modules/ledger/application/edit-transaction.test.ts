import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, anExpense, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createEditTransaction, type EditChanges } from "./edit-transaction";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

/** Ana's Market of 2026-10-31 in a closed October. */
const closedOctober = () => {
  const fixture = ledgerFixture({
    closedPeriods: { isClosed: async (_spaceId, date) => date.startsWith("2026-10") },
  });
  const market = anExpense("2026-10-31", 8_500_000n, { description: "Market" });
  fixture.store.rows.push(market);
  const edit = (changes: EditChanges) =>
    createEditTransaction(fixture.deps)({
      ...asAna,
      transactionId: market.id,
      expectedVersion: 1,
      changes,
    });
  return { ...fixture, market, edit };
};

describe("EditTransaction in a closed period (HU-E4-06, #246)", () => {
  it.each<[string, EditChanges]>([
    ["no field", {}],
    ["the same description", { description: "Market" }],
    ["the same amount", { amount: money(8_500_000n) }],
    ["the same date", { date: "2026-10-31" as LocalDate }],
    ["the same account", { accountId: ACCOUNTS.bancolombia.id }],
  ])("answers the movement as it is for %s, with no new version and no audit", async (_, changes) => {
    const { edit, market, store, audit } = closedOctober();
    expect(unwrap(await edit(changes))).toEqual(market);
    expect(store.rows).toEqual([market]);
    expect(audit.entries).toEqual([]);
  });

  it.each<[string, EditChanges]>([
    ["a new description", { description: "Groceries" }],
    ["a new amount", { amount: money(9_000_000n) }],
    ["a date out of the period", { date: "2026-11-02" as LocalDate }],
    // A change that would fail on its own still answers the closed period first, as it did before.
    ["an unknown account", { accountId: "account-unknown" }],
  ])("still refuses %s with PeriodClosed and changes nothing", async (_, changes) => {
    const { edit, market, store, audit } = closedOctober();
    expect(codeOf(await edit(changes))).toBe("PeriodClosed");
    expect(store.rows).toEqual([market]);
    expect(audit.entries).toEqual([]);
  });
});
