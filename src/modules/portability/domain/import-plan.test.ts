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
  archiveUnusedCategories: true,
  includeDuplicates: [],
});

const none = {
  linkedKeys: new Set<string>(),
  duplicateKeys: new Set<string>(),
  undoneOpenings: new Map<string, string>(),
};

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

  it("folds adjustments on or before a new account's first movement into its opening balance, and records later ones", () => {
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
    // Design Q4 (#329): a later adjustment is an ADJUSTMENT movement of its own, recorded in date order.
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["m1", "adj3"]);
  });

  it("never folds an adjustment into an existing account, whose opening balance the import leaves alone: it records it", () => {
    const plan = planImport(
      snapshotOf([movement("adj1", "ADJUSTMENT", "2025-01-01", 1000n)]),
      mappings("existing"),
      none,
    );
    expect(plan.openingBalances.size).toBe(0);
    expect(plan.folded).toEqual([]);
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["adj1"]);
  });

  it("keeps folded an adjustment an undone import folded into the account it now maps to, never recording it twice", () => {
    const snapshot = snapshotOf([
      movement("adj1", "ADJUSTMENT", "2025-01-01", 1000n),
      movement("m1", "EXPENSE", "2025-01-10", 500n),
    ]);
    const undone = { ...none, undoneOpenings: new Map([[openingKeyOf("adj1"), "acc-1"]]) };
    const plan = planImport(snapshot, mappings("existing"), undone);
    // The restored account still holds it in its opening balance, so nothing is added to it and nothing recorded.
    expect(plan.folded.map((m) => m.sourceKey)).toEqual(["adj1"]);
    expect(plan.openingBalances.size).toBe(0);
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["m1"]);
    // Folded into another account, it is that account's, not this one's: recorded here.
    const elsewhere = { ...none, undoneOpenings: new Map([[openingKeyOf("adj1"), "acc-2"]]) };
    expect(planImport(snapshot, mappings("existing"), elsewhere).toRecord.map((m) => m.sourceKey)).toEqual([
      "adj1",
      "m1",
    ]);
  });

  it("skips what an earlier import linked, adjustments by their opening key, and duplicates not included", () => {
    const snapshot = snapshotOf([
      movement("adj1", "ADJUSTMENT", "2025-01-01", 1000n),
      movement("m1", "EXPENSE", "2025-01-10", 500n),
      movement("m2", "EXPENSE", "2025-01-11", 600n),
      movement("m3", "EXPENSE", "2025-01-12", 700n),
    ]);
    const known = {
      ...none,
      linkedKeys: new Set(["m1", openingKeyOf("adj1")]),
      duplicateKeys: new Set(["m2", "m3"]),
    };
    const plan = planImport(snapshot, { ...mappings("new"), includeDuplicates: ["m3"] }, known);
    expect(plan.alreadyImported).toEqual(["adj1", "m1"]);
    expect(plan.duplicatesSkipped).toEqual(["m2"]);
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["m3"]);
    expect(plan.folded).toEqual([]);
  });

  it("folds an Archivar's adjustments into the account it creates, and keeps an undone fold in the one it merges into (P337)", () => {
    const snapshot = snapshotOf([
      movement("adj1", "ADJUSTMENT", "2025-01-01", 1000n),
      movement("m1", "EXPENSE", "2025-01-10", 500n),
    ]);
    const archived = (accountId: string | null): ImportMappings => ({
      ...mappings("new"),
      accounts: { "a-bank": { kind: "archive", accountId, type: "BANK", currency: "COP" } },
    });
    const created = planImport(snapshot, archived(null), none);
    expect(created.openingBalances.get("a-bank")).toBe(1000n);
    expect(created.toRecord.map((m) => m.sourceKey)).toEqual(["m1"]);

    const merged = planImport(snapshot, archived("acc-1"), none);
    expect(merged.openingBalances.size).toBe(0);
    expect(merged.toRecord.map((m) => m.sourceKey)).toEqual(["adj1", "m1"]);
    const undone = { ...none, undoneOpenings: new Map([[openingKeyOf("adj1"), "acc-1"]]) };
    expect(planImport(snapshot, archived("acc-1"), undone).folded.map((m) => m.sourceKey)).toEqual(["adj1"]);
  });

  it("never folds a Persona's adjustment: it is recorded, as a settlement with that person (P337)", () => {
    const plan = planImport(
      snapshotOf([movement("adj1", "ADJUSTMENT", "2025-01-01", 1000n)]),
      { ...mappings("new"), accounts: { "a-bank": { kind: "person", name: "Mom" } } },
      none,
    );
    expect(plan.openingBalances.size).toBe(0);
    expect(plan.folded).toEqual([]);
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["adj1"]);
  });

  it("skips a recorded adjustment an earlier import linked by its own key, and a likely duplicate one", () => {
    const snapshot = snapshotOf([
      movement("m1", "EXPENSE", "2025-01-10", 500n),
      movement("adj2", "ADJUSTMENT", "2025-02-01", -100n),
      movement("adj3", "ADJUSTMENT", "2025-02-02", 70n),
    ]);
    const known = { ...none, linkedKeys: new Set(["adj2"]), duplicateKeys: new Set(["adj3"]) };
    const plan = planImport(snapshot, mappings("new"), known);
    expect(plan.alreadyImported).toEqual(["adj2"]);
    expect(plan.duplicatesSkipped).toEqual(["adj3"]);
    expect(plan.toRecord.map((m) => m.sourceKey)).toEqual(["m1"]);
  });
});
