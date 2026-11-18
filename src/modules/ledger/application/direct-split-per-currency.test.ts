import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import { createRecordExpense } from "./record-expense";
import { createRecordExpenseByCategoryKey } from "./record-expense-by-category-key";

/**
 * P342 (S3) with P331 and P333: in a two-member (direct) COP space, an expense split with the other member, or paid by
 * them, keeps the currency it was entered in; its parts and payment pass through in that currency and nothing converts.
 */
const usd = (minor: bigint) => money(minor, "USD");

const pair = () => {
  const fixture = householdLedger([memberOf("Ana", "OWNER", 0), memberOf("Juan", "ADMIN", 1)]);
  const record = createRecordExpenseByCategoryKey(
    {
      access: fixture.deps.access,
      spaceLocks: fixture.deps.spaceLocks,
      members: fixture.deps.members,
      categoryKeys: {
        findByKey: async (spaceId, key) =>
          spaceId === "space-household" && key === "groceries" ? CATEGORIES.household : null,
      },
    },
    createRecordExpense(fixture.deps),
  );
  return { ...fixture, record };
};

const dinner = {
  spaceId: "space-household",
  userId: "u-ana",
  date: "2026-11-18" as LocalDate,
  categoryKey: "groceries",
  amount: usd(80_00n),
};

describe("A direct split keeps its own currency (P342, P331, P333)", () => {
  it("splits 80 USD paid from Ana's USD account into USD parts, with no leg and no rate", async () => {
    const { record, store } = pair();
    const { expense } = unwrap(
      await record({
        ...dinner,
        accountId: ACCOUNTS.usdWallet.id,
        pairShares: { mine: usd(30_00n), theirs: usd(50_00n) },
      }),
    );
    expect(expense).toMatchObject({ amount: 80_00n, currency: "USD" });
    expect(expense.shares.map((s) => [s.memberId, s.amount])).toEqual([
      ["member-ana", 30_00n],
      ["member-juan", 50_00n],
    ]);
    expect("accountAmount" in expense.payments[0]!).toBe(false);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-80_00n);
  });

  it("records 80 USD that Juan paid with his own money in USD, moving no account", async () => {
    const { record, store } = pair();
    const { expense } = unwrap(
      await record({ ...dinner, paidByOther: true, pairShares: { mine: usd(80_00n), theirs: usd(0n) } }),
    );
    expect(expense).toMatchObject({ amount: 80_00n, currency: "USD" });
    expect(expense.payments).toEqual([{ memberId: "member-juan", accountId: null, amount: 80_00n }]);
    expect(expense.shares.map((s) => [s.memberId, s.amount])).toEqual([["member-ana", 80_00n]]);
    expect(store.rows).toHaveLength(1);
  });
});
