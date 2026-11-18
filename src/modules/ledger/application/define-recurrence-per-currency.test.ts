import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { materializerWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import { statusOf } from "../domain/recurrence";
import type { Expense } from "../domain/transaction";
import { createUpdateRecurrence } from "./manage-recurrence";
import { materializeRecurrence } from "./materialize-recurrence";
import { occurrenceRecorders } from "./record-occurrence";

/**
 * P342 (S3): Household is COP. A recurrence keeps its own currency, and every occurrence is recorded in it; an account
 * in another currency gets its leg from the occurrence date's rate, and with no rate that day the occurrence waits for
 * a person (PENDING) instead of failing the run or pausing the recurrence.
 */
const usd = (minor: bigint) => money(minor, "USD");
const day = (iso: string) => iso as LocalDate;

/** Ana's AUTO "Hosting", 20 USD of Household paid from this account of hers, MONTHLY(1), from 2026-12-01. */
const hosting = (accountId: string) =>
  rentDefinition({
    description: "Hosting",
    amount: usd(20_00n),
    template: {
      type: "EXPENSE",
      categoryId: CATEGORIES.household.id,
      payer: { memberId: "member-ana", accountId },
      split: null,
    },
  });

describe("A recurrence in its own currency (P342)", () => {
  it("defines a USD recurrence in a COP space and records each occurrence in USD from the USD account", async () => {
    const w = materializerWorld();
    const recurrence = await w.define(hosting(ACCOUNTS.usdWallet.id));
    expect(recurrence).toMatchObject({ amount: 20_00n, currency: "USD" });
    const run = unwrap(await materializeRecurrence(w.deps, recurrence, day("2026-12-01")));
    expect(run.occurrences.map((o) => o.status)).toEqual(["RECORDED"]);
    const [expense] = w.store.rows as Expense[];
    expect(expense).toMatchObject({ amount: 20_00n, currency: "USD", date: "2026-12-01" });
    expect("accountAmount" in expense!.payments[0]!).toBe(false);
    expect(w.store.netOf(ACCOUNTS.usdWallet.id)).toBe(-20_00n);
  });

  it("leaves the occurrence PENDING, unpaused, when no rate gives the COP account's leg that day", async () => {
    const w = materializerWorld();
    const recurrence = await w.define(hosting(ACCOUNTS.bancolombia.id));
    const run = unwrap(await materializeRecurrence(w.deps, recurrence, day("2026-12-01")));
    expect(run).toMatchObject({ pausedFor: null });
    expect(run.occurrences.map((o) => [o.date, o.status, o.reason])).toEqual([
      ["2026-12-01", "PENDING", null],
    ]);
    expect(w.store.rows).toEqual([]);
    expect(statusOf(w.recurrences.rows[0]!)).toBe("ACTIVE");
    expect(w.recurrences.rows[0]!.dueFrom).toBe("2026-12-02");
  });

  it("records the occurrence with the COP account's leg at the date's rate when there is one", async () => {
    const w = materializerWorld();
    const deps = { ...w.deps, rates: fakeRates({ "USD>COP": "4100" }) };
    const recurrence = await w.define(hosting(ACCOUNTS.bancolombia.id));
    const run = unwrap(
      await materializeRecurrence(
        { ...deps, recorders: occurrenceRecorders(deps) },
        recurrence,
        day("2026-12-01"),
      ),
    );
    expect(run.occurrences.map((o) => o.status)).toEqual(["RECORDED"]);
    const [expense] = w.store.rows as Expense[];
    expect(expense).toMatchObject({ amount: 20_00n, currency: "USD" });
    expect(expense!.payments[0]).toMatchObject({ accountAmount: 82_000_00n, accountCurrency: "COP" });
  });

  it("refuses a new amount in another currency than the recurrence's (CurrencyMismatch)", async () => {
    const w = materializerWorld();
    const recurrence = await w.define(hosting(ACCOUNTS.usdWallet.id));
    const update = createUpdateRecurrence(w.deps);
    const ref = { spaceId: "space-household", userId: "u-ana", recurrenceId: recurrence.id };
    expect(await update({ ...ref, changes: { amount: money(80_000_00n) } })).toMatchObject({
      ok: false,
      error: { code: "CurrencyMismatch", details: { expected: "USD", actual: "COP" } },
    });
    expect(codeOf(await update({ ...ref, changes: { amount: usd(25_00n) } }))).toBe("ok");
  });

  it("keeps a COP recurrence in COP, unchanged (single currency)", async () => {
    const w = materializerWorld();
    const recurrence = await w.define(rentDefinition());
    expect(recurrence).toMatchObject({ amount: 120_000_000n, currency: "COP" });
    unwrap(await materializeRecurrence(w.deps, recurrence, day("2026-12-01")));
    expect(w.store.rows.map((tx) => [tx.currency, tx.amount])).toEqual([["COP", 120_000_000n]]);
  });
});
