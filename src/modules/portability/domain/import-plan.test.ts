import { describe, expect, it } from "vitest";
import { localDate, Money, type LocalDate } from "@/shared/kernel";
import type { ImportMappings } from "./import-batch";
import { openingKeyOf, planImport } from "./import-plan";
import type { SourceMovement, SourceSnapshot } from "./source-snapshot";

const day = (iso: string): LocalDate => {
  const parsed = localDate(iso);
  if (!parsed.ok) throw new Error(iso);
  return parsed.value;
};

const cop = (minor: bigint) => {
  const money = Money.ofMinor(minor, "COP");
  if (!money.ok) throw new Error("COP");
  return money.value;
};

const movement = (
  sourceKey: string,
  kind: SourceMovement["kind"],
  date: string,
  minor: bigint,
  account = "a-bank",
): SourceMovement => ({
  sourceKey,
  kind,
  date: day(date),
  occurredAt: null,
  accountSourceId: account,
  toAccountSourceId: null,
  categorySourceId: kind === "EXPENSE" || kind === "INCOME" ? "c-food" : null,
  amount: cop(minor),
  originalAmount: null,
  toAmount: null,
  note: null,
});

const snapshotOf = (movements: SourceMovement[]): SourceSnapshot => ({
  sourceApp: "money-manager",
  accounts: [],
  categories: [],
  movements,
  budgets: [],
  settings: { startDay: null, mainCurrency: "COP" },
  skipped: { zeroAmountMovements: 0, deletedCategories: 0 },
  warnings: [],
  errors: [],
});

const mappings = (bank: "new" | "existing"): ImportMappings => ({
  timeZone: "America/Bogota",
  accounts: {
    "a-bank":
      bank === "new"
        ? { kind: "new", type: "BANK", currency: "COP" }
        : { kind: "existing", accountId: "acc-1" },
  },
  categories: {},
  includeDuplicates: [],
});

const none = { linkedKeys: new Set<string>(), duplicateKeys: new Set<string>() };

describe("planImport (design §3.2, §3.3, gap G1)", () => {
  it("records every movement in date order", () => {
    const plan = planImport(
      snapshotOf([
        movement("m2", "INCOME", "2025-01-15", 3000n),
        movement("m1", "EXPENSE", "2025-01-10", 500n),
      ]),
      mappings("new"),
      none,
    );
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["m1", "m2"]);
  });

  it("folds adjustments on or before a new account's first movement into its opening balance", () => {
    const plan = planImport(
      snapshotOf([
        movement("adj1", "ADJUSTMENT", "2025-01-01", 1000n),
        movement("adj2", "ADJUSTMENT", "2025-01-10", -200n),
        movement("m1", "EXPENSE", "2025-01-10", 500n),
        movement("adj3", "ADJUSTMENT", "2025-02-01", 50n),
      ]),
      mappings("new"),
      none,
    );
    expect(plan.openingBalances.get("a-bank")).toBe(800n);
    expect(plan.folded.map((m) => m.sourceKey)).toEqual(["adj1", "adj2"]);
    expect(plan.adjustmentsNotImported).toEqual(["adj3"]);
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["m1"]);
  });

  it("never folds an adjustment into an existing account, whose opening balance the import leaves alone", () => {
    const plan = planImport(
      snapshotOf([movement("adj1", "ADJUSTMENT", "2025-01-01", 1000n)]),
      mappings("existing"),
      none,
    );
    expect(plan.openingBalances.size).toBe(0);
    expect(plan.adjustmentsNotImported).toEqual(["adj1"]);
  });

  it("skips what an earlier import linked, adjustments by their opening key, and duplicates not included", () => {
    const snapshot = snapshotOf([
      movement("adj1", "ADJUSTMENT", "2025-01-01", 1000n),
      movement("m1", "EXPENSE", "2025-01-10", 500n),
      movement("m2", "EXPENSE", "2025-01-11", 600n),
      movement("m3", "EXPENSE", "2025-01-12", 700n),
    ]);
    const known = { linkedKeys: new Set(["m1", openingKeyOf("adj1")]), duplicateKeys: new Set(["m2", "m3"]) };
    const plan = planImport(snapshot, { ...mappings("new"), includeDuplicates: ["m3"] }, known);
    expect(plan.alreadyImported).toEqual(["adj1", "m1"]);
    expect(plan.duplicatesSkipped).toEqual(["m2"]);
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["m3"]);
    expect(plan.folded).toEqual([]);
  });
});
