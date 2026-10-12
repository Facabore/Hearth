import { describe, expect, it } from "vitest";
import type { PeriodPolicy } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, unwrap } from "../../../../tests/support/fakes";
import {
  aTransfer,
  anExpense,
  anIncome,
  CATEGORIES,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import type { LedgerDeps } from "./deps";
import { createGetTransaction } from "./get-transaction";
import {
  createListTransactions,
  type ListTransactionsInput,
  type TransactionPage,
} from "./list-transactions";
import type { TransactionPosition } from "./ports";

const list = (deps: LedgerDeps, extra: Partial<ListTransactionsInput> = {}) =>
  createListTransactions(deps)({ spaceId: "space-ana", userId: "u-ana", after: null, limit: 50, ...extra });
const withPolicy = (periodPolicy: PeriodPolicy) =>
  ledgerFixture({ access: fakeSpaceAccess(membership({ periodPolicy })) });
const october = () => [
  anExpense("2026-10-05", 8_500_000n, { description: "Market" }),
  anExpense("2026-10-12", 10_000_000n, { description: "Market" }),
  anExpense("2026-10-15", 6_000_000n, { description: "Dinner", categoryId: CATEGORIES.restaurants.id }),
  anIncome("2026-10-25", 320_000_000n, { description: "Salary" }),
];

describe("ListTransactions (HU-E4-05)", () => {
  it("returns the current period newest first with expense and income totals", async () => {
    const { deps, store } = ledgerFixture(); // today is 2026-10-28 in Bogotá
    store.rows.push(...october());
    const page = unwrap(await list(deps));
    expect(page.period).toEqual({ start: "2026-10-01", end: "2026-10-31", label: "2026-10" });
    expect(page.items.map((t) => t.date)).toEqual(["2026-10-25", "2026-10-15", "2026-10-12", "2026-10-05"]);
    expect(page.totals).toEqual({ expenses: 24_500_000n, income: 320_000_000n });
    expect(page.currency).toBe("COP");
  });

  it("filters by category, totals included", async () => {
    const { deps, store } = ledgerFixture();
    store.rows.push(...october());
    const page = unwrap(await list(deps, { period: "2026-10", categoryIds: [CATEGORIES.groceries.id] }));
    expect(page.items).toHaveLength(2);
    expect(page.totals.expenses).toBe(18_500_000n);
  });

  it("hides soft-deleted transactions", async () => {
    const { deps, store } = ledgerFixture();
    const rows = october();
    rows[2] = { ...rows[2]!, deletedAt: new Date() };
    store.rows.push(...rows);
    expect(unwrap(await list(deps, { period: "2026-10" })).items).toHaveLength(3);
  });

  it("pages through 120 transactions 50 at a time", async () => {
    const { deps, store } = ledgerFixture();
    for (let n = 0; n < 120; n++) {
      store.rows.push(anExpense(`2026-10-${String((n % 28) + 1).padStart(2, "0")}`, 100n));
    }
    const sizes: number[] = [];
    const seen = new Set<string>();
    let after: TransactionPosition | null = null;
    do {
      const page: TransactionPage = unwrap(await list(deps, { period: "2026-10", after }));
      sizes.push(page.items.length);
      page.items.forEach((t) => seen.add(t.id));
      after = page.nextPosition;
    } while (after);
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen.size).toBe(120);
  });

  it("filters by payer and participant member", async () => {
    const { deps, store } = ledgerFixture();
    const juanPays = anExpense("2026-10-10", 10_000_000n, {
      payments: [{ memberId: "member-juan", accountId: null, amount: 10_000_000n }],
      shares: [
        { memberId: "member-ana", amount: 5_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-juan", amount: 5_000_000n, splitMethod: "EQUAL" },
      ],
    });
    store.rows.push(anExpense("2026-10-09", 30_000_000n), juanPays);
    const ids = async (extra: Partial<ListTransactionsInput>) =>
      unwrap(await list(deps, { period: "2026-10", ...extra })).items.map((t) => t.id);
    expect(await ids({ payerMemberId: "member-juan" })).toEqual([juanPays.id]);
    expect(await ids({ participantMemberId: "member-juan" })).toEqual([juanPays.id]);
  });

  it("never counts income or transfers as spending (HU-E4-02, HU-E4-03)", async () => {
    const { deps, store } = ledgerFixture();
    store.rows.push(
      anIncome("2026-10-25", 320_000_000n),
      anExpense("2026-10-05", 8_500_000n),
      aTransfer("2026-10-06", 50_000_000n),
    );
    const page = unwrap(await list(deps, { period: "2026-10" }));
    expect(page.totals.expenses).toBe(8_500_000n);
    expect(page.items).toHaveLength(3);
    expect(page.items.find((t) => t.type === "TRANSFER")?.categoryId).toBeNull();
  });

  it("rejects an unknown period label and hides other spaces", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await list(deps, { period: "2026-13" }))).toBe("InvalidPeriodLabel");
    expect(codeOf(await list(deps, { userId: "u-luis" }))).toBe("SpaceNotFound");
  });
});

describe("period assignment (HU-E4-04)", () => {
  it("MONTHLY(1): 2026-10 holds October 31 but not November 1", async () => {
    const { deps, store } = withPolicy({ kind: "MONTHLY", day: 1 });
    store.rows.push(anExpense("2026-10-31", 8_500_000n), anExpense("2026-11-01", 4_000_000n));
    const page = unwrap(await list(deps, { period: "2026-10" }));
    expect(page.period).toEqual({ start: "2026-10-01", end: "2026-10-31", label: "2026-10" });
    expect(page.totals.expenses).toBe(8_500_000n);
  });

  it("MONTHLY(25): 2026-11 runs from October 25 to November 24", async () => {
    const { deps, store } = withPolicy({ kind: "MONTHLY", day: 25 });
    store.rows.push(anExpense("2026-10-24", 12_000_000n), anExpense("2026-10-25", 6_000_000n));
    const page = unwrap(await list(deps, { period: "2026-11" }));
    expect(page.period).toEqual({ start: "2026-10-25", end: "2026-11-24", label: "2026-11" });
    expect(page.totals.expenses).toBe(6_000_000n);
  });

  it("SEMI_MONTHLY(1, 16): each half of November has its own total", async () => {
    const { deps, store } = withPolicy({ kind: "SEMI_MONTHLY", day1: 1, day2: 16 });
    store.rows.push(anExpense("2026-11-10", 7_000_000n), anExpense("2026-11-20", 5_000_000n));
    const first = unwrap(await list(deps, { period: "2026-11 H1" }));
    const second = unwrap(await list(deps, { period: "2026-11 H2" }));
    expect([first.period.start, first.period.end, first.totals.expenses]).toEqual([
      "2026-11-01",
      "2026-11-15",
      7_000_000n,
    ]);
    expect([second.period.start, second.period.end, second.totals.expenses]).toEqual([
      "2026-11-16",
      "2026-11-30",
      5_000_000n,
    ]);
  });

  it("MONTHLY(31): 2027-03 starts on the clamped February 28 (Review Focus 3)", async () => {
    const { deps, store } = withPolicy({ kind: "MONTHLY", day: 31 });
    store.rows.push(anExpense("2027-02-27", 1_000n), anExpense("2027-02-28", 2_000n));
    const page = unwrap(await list(deps, { period: "2027-03" }));
    expect(page.period).toEqual({ start: "2027-02-28", end: "2027-03-30", label: "2027-03" });
    expect(page.totals.expenses).toBe(2_000n);
  });
});

describe("GetTransaction", () => {
  it("returns a live transaction of the space and hides deleted or foreign ones", async () => {
    const { deps, store } = ledgerFixture();
    const live = anExpense("2026-10-05", 100n);
    const deleted = anExpense("2026-10-06", 100n, { deletedAt: new Date() });
    const foreign = anExpense("2026-10-07", 100n, { spaceId: "space-juan" });
    store.rows.push(live, deleted, foreign);
    const get = createGetTransaction(deps);
    expect(unwrap(await get({ spaceId: "space-ana", userId: "u-ana", transactionId: live.id }))).toEqual(
      live,
    );
    for (const tx of [deleted, foreign]) {
      expect(codeOf(await get({ spaceId: "space-ana", userId: "u-ana", transactionId: tx.id }))).toBe(
        "TransactionNotFound",
      );
    }
  });
});
