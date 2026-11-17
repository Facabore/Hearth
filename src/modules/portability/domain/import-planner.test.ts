import { describe, expect, it } from "vitest";
import { isErr, isOk, Money } from "@/shared/kernel";
import type { LocalDate } from "@/shared/kernel";
import { previewImport } from "./import-planner";
import type { SourceAccount, SourceMovement, SourceSnapshot } from "./source-snapshot";

const cop = (minor: bigint): Money => {
  const money = Money.ofMinor(minor, "COP");
  if (isErr(money)) throw new Error(money.error.code);
  return money.value;
};

const account = (over: Partial<SourceAccount> & Pick<SourceAccount, "sourceId" | "type">): SourceAccount => ({
  name: over.sourceId,
  currency: "COP",
  order: 0,
  cutOffDay: null,
  paymentDay: null,
  memo: null,
  hidden: false,
  excludedFromTotals: false,
  ...over,
});

const movement = (
  over: Partial<SourceMovement> & Pick<SourceMovement, "sourceKey" | "kind" | "accountSourceId" | "amount">,
): SourceMovement => ({
  date: "2025-01-10" as LocalDate,
  occurredAt: null,
  toAccountSourceId: null,
  categorySourceId: null,
  originalAmount: null,
  toAmount: null,
  note: null,
  ...over,
});

const snapshot = (over: Partial<SourceSnapshot> = {}): SourceSnapshot => ({
  sourceApp: "money-manager",
  accounts: [],
  categories: [],
  movements: [],
  budgets: [],
  settings: { startDay: 1, mainCurrency: "COP" },
  skipped: { zeroAmountMovements: 0, deletedCategories: 0 },
  warnings: [],
  errors: [],
  ...over,
});

describe("previewImport (design §3.1, §3.2)", () => {
  it("counts movements by kind and reports the date range", () => {
    const snap = snapshot({
      accounts: [account({ sourceId: "a", type: "BANK" })],
      movements: [
        movement({
          sourceKey: "m1",
          kind: "EXPENSE",
          accountSourceId: "a",
          amount: cop(5000n),
          date: "2025-01-10" as LocalDate,
        }),
        movement({
          sourceKey: "m2",
          kind: "INCOME",
          accountSourceId: "a",
          amount: cop(300000n),
          date: "2025-03-15" as LocalDate,
        }),
        movement({
          sourceKey: "m3",
          kind: "ADJUSTMENT",
          accountSourceId: "a",
          amount: cop(-1000n),
          date: "2025-02-01" as LocalDate,
        }),
      ],
      skipped: { zeroAmountMovements: 2, deletedCategories: 1 },
    });

    const preview = previewImport(snap, { timeZone: "America/Bogota" });
    expect(isOk(preview)).toBe(true);
    if (isErr(preview)) return;
    expect(preview.value.counts).toMatchObject({
      income: 1,
      expense: 1,
      transfer: 0,
      adjustment: 1,
      total: 3,
    });
    expect(preview.value.counts.skippedZero).toBe(2);
    expect(preview.value.dateRange).toEqual({ first: "2025-01-10", last: "2025-03-15" });
    expect(preview.value.leftOut.zeroAmountMovements).toBe(2);
  });

  it("proposes a new account per source account, with its type, currency and closing balance", () => {
    const snap = snapshot({
      accounts: [
        account({ sourceId: "bank", type: "BANK", name: "Bancolombia" }),
        account({ sourceId: "card", type: "CREDIT_CARD", name: "Visa", cutOffDay: 15, paymentDay: 5 }),
      ],
      movements: [
        movement({ sourceKey: "m1", kind: "INCOME", accountSourceId: "bank", amount: cop(300000n) }),
        movement({ sourceKey: "m2", kind: "EXPENSE", accountSourceId: "bank", amount: cop(50000n) }),
        movement({ sourceKey: "m3", kind: "EXPENSE", accountSourceId: "card", amount: cop(20000n) }),
      ],
    });

    const preview = previewImport(snap, { timeZone: "America/Bogota" });
    if (isErr(preview)) throw new Error(preview.error.code);
    const bank = preview.value.accounts.find((a) => a.sourceId === "bank")!;
    expect(bank.mapping).toEqual({ kind: "new", type: "BANK", currency: "COP" });
    expect(bank.sourceClosingBalance.minor).toBe(250000n);
    const card = preview.value.accounts.find((a) => a.sourceId === "card")!;
    expect(card.mapping).toEqual({ kind: "new", type: "CREDIT_CARD", currency: "COP" });
    expect(card.cutOffDay).toBe(15);
    expect(card.paymentDay).toBe(5);
    expect(card.sourceClosingBalance.minor).toBe(-20000n);
  });

  it("lists how many budgets were left out", () => {
    const snap = snapshot({
      budgets: [
        { sourceId: "b1", categorySourceId: null },
        { sourceId: "b2", categorySourceId: "food" },
      ],
    });
    const preview = previewImport(snap, { timeZone: "America/Bogota" });
    if (isErr(preview)) throw new Error(preview.error.code);
    expect(preview.value.leftOut.budgets).toBe(2);
  });

  it("flags a movement that matches an already-present Hearth movement as a duplicate", () => {
    const snap = snapshot({
      accounts: [account({ sourceId: "bank", type: "BANK" })],
      movements: [
        movement({
          sourceKey: "m1",
          kind: "EXPENSE",
          accountSourceId: "bank",
          amount: cop(50000n),
          date: "2025-01-10" as LocalDate,
        }),
      ],
    });
    const preview = previewImport(snap, {
      timeZone: "America/Bogota",
      existing: [
        { accountSourceId: "bank", date: "2025-01-10" as LocalDate, amountMinor: 50000n, kind: "EXPENSE" },
      ],
    });
    if (isErr(preview)) throw new Error(preview.error.code);
    expect(preview.value.duplicates).toEqual([{ sourceKey: "m1" }]);
  });

  it("has no date range when there are no movements", () => {
    const preview = previewImport(snapshot(), { timeZone: "America/Bogota" });
    if (isErr(preview)) throw new Error(preview.error.code);
    expect(preview.value.dateRange).toBeNull();
    expect(preview.value.counts.total).toBe(0);
  });

  it("warns when a movement's date is not its instant's date in the chosen zone, and keeps the date (§2.3)", () => {
    const snap = snapshot({
      accounts: [account({ sourceId: "a", type: "BANK" })],
      movements: [
        // 2025-01-10 03:00 UTC is 2025-01-09 22:00 in Bogotá (UTC−5).
        movement({
          sourceKey: "late",
          kind: "EXPENSE",
          accountSourceId: "a",
          amount: cop(100n),
          date: "2025-01-10" as LocalDate,
          occurredAt: new Date(Date.UTC(2025, 0, 10, 3)),
        }),
        movement({
          sourceKey: "same",
          kind: "EXPENSE",
          accountSourceId: "a",
          amount: cop(100n),
          date: "2025-01-10" as LocalDate,
          occurredAt: new Date(Date.UTC(2025, 0, 10, 5)),
        }),
        movement({ sourceKey: "no-instant", kind: "EXPENSE", accountSourceId: "a", amount: cop(100n) }),
      ],
      warnings: [{ code: "TransferIncomplete", sourceKey: "t9" }],
    });

    const bogota = previewImport(snap, { timeZone: "America/Bogota" });
    if (isErr(bogota)) throw new Error(bogota.error.code);
    expect(bogota.value.warnings).toEqual([
      { code: "TransferIncomplete", sourceKey: "t9" },
      {
        code: "DateZoneMismatch",
        sourceKey: "late",
        details: { date: "2025-01-10", zoneDate: "2025-01-09", timeZone: "America/Bogota" },
      },
    ]);
    expect(bogota.value.dateRange).toEqual({ first: "2025-01-10", last: "2025-01-10" });

    // In UTC and in Tokyo both instants fall on 2025-01-10: the chosen zone is what the check reads.
    const utc = previewImport(snap, { timeZone: "UTC" });
    if (isErr(utc)) throw new Error(utc.error.code);
    expect(utc.value.warnings.filter((w) => w.code === "DateZoneMismatch").map((w) => w.sourceKey)).toEqual(
      [],
    );
    const tokyo = previewImport(snap, { timeZone: "Asia/Tokyo" });
    if (isErr(tokyo)) throw new Error(tokyo.error.code);
    expect(tokyo.value.warnings.filter((w) => w.code === "DateZoneMismatch").map((w) => w.sourceKey)).toEqual(
      [],
    );
  });

  it("refuses an unknown time zone", () => {
    const preview = previewImport(snapshot(), { timeZone: "Mars/Olympus" });
    expect(isErr(preview) && preview.error.code).toBe("InvalidTimeZone");
  });

  it("lists the rows the adapter could not read as errors per row (§3.2)", () => {
    const errors = [{ code: "InvalidMoneyPrecision", sourceKey: "m9", details: { value: "12.345" } }];
    const preview = previewImport(snapshot({ errors }), { timeZone: "America/Bogota" });
    if (isErr(preview)) throw new Error(preview.error.code);
    expect(preview.value.errors).toEqual(errors);
  });
});

describe("likely duplicate transfers (design §3.1)", () => {
  const transfer = movement({
    sourceKey: "t1",
    kind: "TRANSFER",
    accountSourceId: "bank",
    toAccountSourceId: "cash",
    amount: cop(20000n),
    toAmount: cop(20000n),
    date: "2025-01-25" as LocalDate,
  });
  const snap = snapshot({
    accounts: [account({ sourceId: "bank", type: "BANK" }), account({ sourceId: "cash", type: "CASH" })],
    movements: [transfer],
  });
  const duplicatesWith = (existing: Parameters<typeof previewImport>[1]["existing"]) => {
    const preview = previewImport(snap, { timeZone: "America/Bogota", existing });
    if (isErr(preview)) throw new Error(preview.error.code);
    return preview.value.duplicates;
  };
  const on = (accountSourceId: string, incoming?: true) => ({
    accountSourceId,
    date: "2025-01-25" as LocalDate,
    amountMinor: 20000n,
    kind: "TRANSFER" as const,
    ...(incoming === undefined ? {} : { incoming }),
  });

  it("finds a transfer that reached the destination account in Hearth, whatever account it left", () => {
    expect(duplicatesWith([on("cash", true)])).toEqual([{ sourceKey: "t1" }]);
  });

  it("finds one that left the source account, and never takes a transfer leaving an account as one reaching it", () => {
    expect(duplicatesWith([on("bank")])).toEqual([{ sourceKey: "t1" }]);
    expect(duplicatesWith([on("cash")])).toEqual([]);
    expect(duplicatesWith([on("bank", true)])).toEqual([]);
  });
});
