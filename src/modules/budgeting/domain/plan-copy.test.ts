import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import type { BudgetLineId } from "./budget-line";
import { copiedParts, type CopyInput } from "./plan-copy";
import type { PlanParts } from "./plan-figures";

const NOW = new Date("2026-11-30T12:00:00Z");
const ANA = "member-ana";
const JUAN = "member-juan";
const LUIS = "member-luis";

/**
 * HU-E6-06 Background: the reference plan for 2026-11 with its capacities, lines, mappings and allocations. Its lines
 * cover the three rollover modes (HU-E6-09): Rent ROLLOVER, Home ADJUSTED, Savings and Free RESET.
 */
const november = (overrides: Partial<PlanParts> = {}): PlanParts => ({
  capacities: [
    { memberId: ANA, amount: 160_000_000n },
    { memberId: JUAN, amount: 240_000_000n },
  ],
  lines: referenceLines().map((l) => {
    if (l.name === "Free") return { ...l, allocationRule: "PERCENT" as const };
    if (l.name === "Rent") return { ...l, rolloverMode: "ROLLOVER" as const };
    if (l.name === "Home") return { ...l, rolloverMode: "ADJUSTED" as const };
    return l;
  }),
  mappings: [
    { lineId: "line-home", categoryId: "cat-groceries" },
    { lineId: "line-home", categoryId: "cat-utilities" },
  ],
  allocations: [
    { lineId: "line-free", memberId: ANA, value: 4200n },
    { lineId: "line-free", memberId: JUAN, value: 5800n },
  ],
  ...overrides,
});

const copy = (source: PlanParts, overrides: Partial<CopyInput> = {}) =>
  copiedParts({
    planId: "plan-december",
    now: NOW,
    source,
    lineIds: source.lines.map((l) => `copy-${l.id}` as BudgetLineId),
    memberIds: [ANA, JUAN],
    categories: [
      { id: "cat-groceries", archived: false },
      { id: "cat-utilities", archived: false },
    ],
    usableAccountIds: ["acc-savings"],
    viewerIds: [],
    ...overrides,
  });

describe("copiedParts (HU-E6-06)", () => {
  it("clones capacities, lines, mappings and allocations with new ids and links to the source lines (@critical)", () => {
    const { parts, dropped } = copy(november());
    expect(parts.capacities).toEqual(november().capacities);
    expect(
      parts.lines.map((l) => [
        l.id,
        l.planId,
        l.originLineId,
        l.name,
        l.plannedAmount,
        l.funding,
        l.rolloverMode,
      ]),
    ).toEqual([
      ["copy-line-rent", "plan-december", "line-rent", "Rent", 120_000_000n, "SHARED_FUND", "ROLLOVER"],
      ["copy-line-home", "plan-december", "line-home", "Home", 147_000_000n, "DIRECT", "ADJUSTED"],
      ["copy-line-savings", "plan-december", "line-savings", "Savings", 60_000_000n, "SAVINGS", "RESET"],
      ["copy-line-free", "plan-december", "line-free", "Free", 73_000_000n, "DIRECT", "RESET"],
    ]);
    expect(parts.lines.map((l) => [l.isCatchAll, l.allocationRule, l.savingsAccountIds])).toEqual([
      [false, "PROPORTIONAL", []],
      [false, "PROPORTIONAL", []],
      [false, "PROPORTIONAL", ["acc-savings"]],
      [true, "PERCENT", []],
    ]);
    expect(parts.mappings).toEqual([
      { lineId: "copy-line-home", categoryId: "cat-groceries" },
      { lineId: "copy-line-home", categoryId: "cat-utilities" },
    ]);
    expect(parts.allocations).toEqual([
      { lineId: "copy-line-free", memberId: ANA, value: 4200n },
      { lineId: "copy-line-free", memberId: JUAN, value: 5800n },
    ]);
    expect(dropped).toEqual({ mappings: [], savingsAccounts: [], lines: [] });
  });

  it("keeps the source's line order: each copy is created a millisecond after the one before", () => {
    const { parts } = copy(november());
    expect(parts.lines.map((l) => l.createdAt.getTime() - NOW.getTime())).toEqual([0, 1, 2, 3]);
  });

  it("gives every copy a new id and leaves the source untouched, ids, links and values included", () => {
    const source = november();
    const before = structuredClone(source);
    const { parts } = copy(source);
    const sourceIds = new Set<string>(source.lines.map((l) => l.id));
    expect(parts.lines.every((l) => !sourceIds.has(l.id))).toBe(true);
    expect(new Set(parts.lines.map((l) => l.id)).size).toBe(parts.lines.length);
    expect(parts.lines.map((l) => l.originLineId)).toEqual(source.lines.map((l) => l.id));
    expect(parts.mappings.every((m) => !sourceIds.has(m.lineId))).toBe(true);
    expect(parts.allocations.every((a) => !sourceIds.has(a.lineId))).toBe(true);
    expect(source).toEqual(before);
  });

  it("drops the mapping of a category archived since, and one that is no longer live, listing both", () => {
    const archived = copy(november(), {
      categories: [
        { id: "cat-groceries", archived: false },
        { id: "cat-utilities", archived: true },
      ],
    });
    expect(archived.parts.mappings).toEqual([{ lineId: "copy-line-home", categoryId: "cat-groceries" }]);
    expect(archived.dropped.mappings).toEqual([{ lineId: "copy-line-home", categoryId: "cat-utilities" }]);
    const gone = copy(november(), { categories: [{ id: "cat-groceries", archived: false }] });
    expect(gone.parts.mappings).toEqual([{ lineId: "copy-line-home", categoryId: "cat-groceries" }]);
    expect(gone.dropped.mappings).toEqual([{ lineId: "copy-line-home", categoryId: "cat-utilities" }]);
  });

  it("leaves out Luis, who left: his capacity and his 10 % of Free, whose values then no longer add up", () => {
    const { parts, dropped } = copy(
      november({
        capacities: [
          { memberId: ANA, amount: 160_000_000n },
          { memberId: JUAN, amount: 240_000_000n },
          { memberId: LUIS, amount: 50_000_000n },
        ],
        allocations: [
          { lineId: "line-free", memberId: ANA, value: 4200n },
          { lineId: "line-free", memberId: JUAN, value: 4800n },
          { lineId: "line-free", memberId: LUIS, value: 1000n },
        ],
      }),
    );
    expect(parts.capacities.map((c) => c.memberId)).toEqual([ANA, JUAN]);
    expect(parts.allocations.map((a) => [a.memberId, a.value])).toEqual([
      [ANA, 4200n],
      [JUAN, 4800n],
    ]);
    // The line keeps its PERCENT rule; reading it flags it InvalidAllocation, which is not decided here.
    expect(parts.lines.find((l) => l.originLineId === "line-free")?.allocationRule).toBe("PERCENT");
    expect(dropped).toEqual({ mappings: [], savingsAccounts: [], lines: [] });
  });

  it("leaves out Sofi, now a VIEWER: her capacity and her 10 % of Free, as for a member who left (#217, P261)", () => {
    const SOFI = "member-sofi";
    const { parts, dropped } = copy(
      november({
        capacities: [
          { memberId: ANA, amount: 160_000_000n },
          { memberId: JUAN, amount: 240_000_000n },
          { memberId: SOFI, amount: 50_000_000n },
        ],
        allocations: [
          { lineId: "line-free", memberId: ANA, value: 4200n },
          { lineId: "line-free", memberId: JUAN, value: 4800n },
          { lineId: "line-free", memberId: SOFI, value: 1000n },
        ],
      }),
      { memberIds: [ANA, JUAN, SOFI], viewerIds: [SOFI] },
    );
    expect(parts.capacities.map((c) => c.memberId)).toEqual([ANA, JUAN]);
    expect(parts.allocations.map((a) => [a.memberId, a.value])).toEqual([
      [ANA, 4200n],
      [JUAN, 4800n],
    ]);
    expect(dropped).toEqual({ mappings: [], savingsAccounts: [], lines: [] });
  });

  it("keeps the accounts that still qualify, lists the others, and leaves out a SAVINGS line left without one (P10)", () => {
    const lines = [
      aLine("Savings", 60_000_000n, {
        funding: "SAVINGS",
        savingsAccountIds: ["acc-savings", "acc-juan-savings"],
      }),
      aLine("Reserve", 10_000_000n, { funding: "SAVINGS", savingsAccountIds: ["acc-old-savings"] }),
      aLine("Home", 147_000_000n),
    ];
    const { parts, dropped } = copy(november({ lines, mappings: [], allocations: [] }));
    expect(parts.lines.map((l) => [l.name, l.savingsAccountIds])).toEqual([
      ["Savings", ["acc-savings"]],
      ["Home", []],
    ]);
    expect(dropped).toEqual({
      mappings: [],
      savingsAccounts: [{ lineId: "copy-line-savings", accountId: "acc-juan-savings" }],
      lines: [{ originLineId: "line-reserve", name: "Reserve" }],
    });
    expect(parts.lines.map((l) => l.createdAt.getTime() - NOW.getTime())).toEqual([0, 1]);
  });

  it("does not copy a SAVINGS line left without accounts, nor its allocation values, and lists only the line", () => {
    const lines = [
      aLine("Reserve", 10_000_000n, {
        funding: "SAVINGS",
        savingsAccountIds: ["acc-old-savings"],
        allocationRule: "FIXED",
      }),
      aLine("Home", 147_000_000n),
    ];
    const { parts, dropped } = copy(
      november({
        lines,
        mappings: [{ lineId: "line-home", categoryId: "cat-utilities" }],
        allocations: [{ lineId: "line-reserve", memberId: ANA, value: 10_000_000n }],
      }),
    );
    expect(parts.lines.map((l) => [l.id, l.originLineId])).toEqual([["copy-line-home", "line-home"]]);
    expect(parts.mappings).toEqual([{ lineId: "copy-line-home", categoryId: "cat-utilities" }]);
    expect(parts.allocations).toEqual([]);
    expect(dropped).toEqual({
      mappings: [],
      savingsAccounts: [],
      lines: [{ originLineId: "line-reserve", name: "Reserve" }],
    });
  });

  it("refuses, as a programming error, a list of new ids that is not one per source line", () => {
    const source = november();
    const ids = source.lines.map((l) => `copy-${l.id}` as BudgetLineId);
    expect(() => copy(source, { lineIds: ids.slice(1) })).toThrow(
      new Error("copiedParts needs one new line id per source line"),
    );
    expect(() => copy(source, { lineIds: [...ids, "extra" as BudgetLineId] })).toThrow(
      "copiedParts needs one new line id per source line",
    );
    expect(() => copy(source, { lineIds: ids })).not.toThrow();
  });

  it("takes each line's new id by its place in the source, a line left out included", () => {
    const lines = [
      aLine("Reserve", 10_000_000n, { funding: "SAVINGS", savingsAccountIds: ["acc-old-savings"] }),
      aLine("Home", 147_000_000n),
      aLine("Free", 73_000_000n),
    ];
    const { parts } = copy(november({ lines, mappings: [], allocations: [] }), {
      lineIds: ["new-1", "new-2", "new-3"] as BudgetLineId[],
    });
    expect(parts.lines.map((l) => [l.id, l.originLineId])).toEqual([
      ["new-2", "line-home"],
      ["new-3", "line-free"],
    ]);
  });
});
