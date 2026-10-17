import { describe, expect, it } from "vitest";
import type { SpaceMember } from "@/modules/spaces/application";
import type { LocalDate, PeriodPolicy } from "@/shared/kernel";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, budgetingWorld, HOUSEHOLD, NOW } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import type { PlanParts } from "../domain/plan-figures";
import { createCopyBudgetPlan, type PlanCopy } from "./copy-budget-plan";
import { createCreateBudgetPlan } from "./create-budget-plan";
import type { BudgetCategories } from "./ports";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");
const MARTA = memberOf("Marta", "MEMBER", 4);

/**
 * Household's live categories; `archived` names those archived since the source plan was made and `subcategories`
 * those moved under Groceries since (HU-E3-04).
 */
const categories = (archived: readonly string[], subcategories: readonly string[]): BudgetCategories => ({
  list: async () =>
    ["cat-groceries", "cat-utilities", "cat-outings"].map((id) => ({
      id,
      archived: archived.includes(id),
      parentCategoryId: subcategories.includes(id) ? "cat-groceries" : null,
    })),
});

/**
 * HU-E6-06 Background: Household's plan for the first of `periods` (2026-11 unless given) with the reference
 * capacities, lines (Free PERCENT 42 / 58, catch-all), Groceries and Utilities mapped to Home; `parts` overrides.
 */
const world = async (
  options: {
    readonly members?: readonly SpaceMember[];
    readonly parts?: Partial<PlanParts>;
    readonly archived?: readonly string[];
    readonly subcategories?: readonly string[];
    readonly periodPolicy?: PeriodPolicy;
    readonly periods?: readonly string[];
  } = {},
) => {
  const w = budgetingWorld({ members: options.members ?? ANA_AND_JUAN, periodPolicy: options.periodPolicy });
  const deps = {
    ...w.deps,
    capacities: w.plans,
    lines: w.plans,
    mappings: w.plans,
    allocations: w.plans,
    categories: categories(options.archived ?? [], options.subcategories ?? []),
  };
  const create = createCreateBudgetPlan(deps);
  const [first] = options.periods ?? ["2026-11"];
  const source = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: first! })).plan;
  w.plans.seed(source.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: referenceLines().map((l) =>
      l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l,
    ),
    mappings: [
      { lineId: "line-home", categoryId: "cat-groceries" },
      { lineId: "line-home", categoryId: "cat-utilities" },
    ],
    allocations: [
      { lineId: "line-free", memberId: "member-ana", value: 4200n },
      { lineId: "line-free", memberId: "member-juan", value: 5800n },
    ],
    ...options.parts,
  });
  const copy = createCopyBudgetPlan(deps);
  const copyInto = (period: string, userId = "u-ana") => copy({ spaceId: HOUSEHOLD, userId, period });
  return { ...w, source, copyInto };
};
const line = (copy: PlanCopy, name: string) => copy.view.figures.lines.find((l) => l.line.name === name)!;

/**
 * HU-E6-06, ruling P10: Savings names Ana's, Juan's and Marta's accounts, Ana's archived one, her USD one and her
 * BANK one; Reserve names only the archived and the USD ones; Trip names Luis's, who is not a member.
 */
const savingsLines = () => [
  aLine("Savings", 60_000_000n, {
    funding: "SAVINGS",
    savingsAccountIds: [
      "acc-savings",
      "acc-juan-savings",
      "acc-marta-savings",
      "acc-old-savings",
      "acc-usd-savings",
      "acc-bank",
    ],
  }),
  aLine("Reserve", 10_000_000n, {
    funding: "SAVINGS",
    savingsAccountIds: ["acc-old-savings", "acc-usd-savings"],
  }),
  aLine("Trip", 10_000_000n, { funding: "SAVINGS", savingsAccountIds: ["acc-luis-savings"] }),
];
const savingsParts = { lines: savingsLines(), mappings: [], allocations: [] };

describe("CopyBudgetPlan (HU-E6-06)", () => {
  it("creates the 2026-12 plan as a DRAFT copy of 2026-11 (@critical)", async () => {
    const { source, copyInto } = await world();
    const copy = unwrap(await copyInto("2026-12"));
    expect(copy.view.plan).toEqual({
      id: "budget-2",
      spaceId: HOUSEHOLD,
      period: { label: "2026-12", start: "2026-12-01", end: "2026-12-31" },
      status: "DRAFT",
      createdFrom: source.id,
      version: 1,
      createdBy: "u-ana",
      createdAt: NOW,
    });
    expect(copy.view.figures.capacities.map((c) => [c.memberId, c.amount])).toEqual([
      ["member-ana", 160_000_000n],
      ["member-juan", 240_000_000n],
    ]);
    expect(
      copy.view.figures.lines.map((l) => [
        l.line.name,
        l.line.plannedAmount,
        l.line.funding,
        l.line.rolloverMode,
        l.line.allocationRule,
        l.line.originLineId,
        l.categoryIds,
      ]),
    ).toEqual([
      ["Rent", 120_000_000n, "SHARED_FUND", "RESET", "PROPORTIONAL", "line-rent", []],
      [
        "Home",
        147_000_000n,
        "DIRECT",
        "RESET",
        "PROPORTIONAL",
        "line-home",
        ["cat-groceries", "cat-utilities"],
      ],
      ["Savings", 60_000_000n, "SAVINGS", "RESET", "PROPORTIONAL", "line-savings", []],
      ["Free", 73_000_000n, "DIRECT", "RESET", "PERCENT", "line-free", []],
    ]);
    expect(line(copy, "Free").allocation.members.map((m) => [m.memberId, m.value])).toEqual([
      ["member-ana", 4200n],
      ["member-juan", 5800n],
    ]);
    expect([line(copy, "Free").line.isCatchAll, line(copy, "Savings").line.savingsAccountIds]).toEqual([
      true,
      ["acc-savings"],
    ]);
    expect(copy.dropped).toEqual({ mappings: [], savingsAccounts: [], lines: [] });
  });

  it("leaves the 2026-11 plan as it was", async () => {
    const { plans, source, copyInto } = await world();
    const before = [await plans.find(HOUSEHOLD, source.id), await plans.contents(source.id)];
    unwrap(await copyInto("2026-12"));
    expect([await plans.find(HOUSEHOLD, source.id), await plans.contents(source.id)]).toEqual(before);
  });

  it("answers NoPreviousPlan without a plan for 2026-11, even when 2026-10 has one", async () => {
    const { plans, copyInto } = await world({ periods: ["2026-10"] });
    expect(codeOf(await copyInto("2026-12"))).toBe("NoPreviousPlan");
    expect(plans.plans).toHaveLength(1);
  });

  it("copies from the previous period of a SEMI_MONTHLY policy: H2 from H1, then the next H1 from H2 (spec 5.3)", async () => {
    const { source, copyInto } = await world({
      periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
      periods: ["2026-11 H1"],
    });
    const h2 = unwrap(await copyInto("2026-11 H2")).view.plan;
    const h1 = unwrap(await copyInto("2026-12 H1")).view.plan;
    expect([h2.createdFrom, h2.period.start, h1.createdFrom, h1.period.start]).toEqual([
      source.id,
      "2026-11-16",
      h2.id,
      "2026-12-01",
    ]);
  });

  it("copies the plan stored right before a period that D10 started the day after it", async () => {
    const { plans, source, copyInto } = await world({ periodPolicy: { kind: "MONTHLY", day: 25 } });
    // A policy change left the 2026-11 plan on 2026-11-01..2026-11-30; 2026-12 then starts on 2026-12-01 (HU-E1-03).
    plans.plans = plans.plans.map((p) => ({
      ...p,
      period: { label: "2026-11", start: "2026-11-01" as LocalDate, end: "2026-11-30" as LocalDate },
    }));
    const copy = unwrap(await copyInto("2026-12")).view.plan;
    expect([copy.createdFrom, copy.period.start, copy.period.end]).toEqual([
      source.id,
      "2026-12-01",
      "2026-12-24",
    ]);
  });

  it("drops the mapping of Utilities, archived after the 2026-11 plan was made, and lists it", async () => {
    const { copyInto } = await world({ archived: ["cat-utilities"] });
    const copy = unwrap(await copyInto("2026-12"));
    expect(line(copy, "Home").categoryIds).toEqual(["cat-groceries"]);
    expect(copy.dropped.mappings).toEqual([
      { lineId: line(copy, "Home").line.id, categoryId: "cat-utilities" },
    ]);
  });

  it("drops the mapping of Utilities, moved under Groceries after the 2026-11 plan was made, and lists it (P48)", async () => {
    const { copyInto } = await world({ subcategories: ["cat-utilities"] });
    const copy = unwrap(await copyInto("2026-12"));
    expect(line(copy, "Home").categoryIds).toEqual(["cat-groceries"]);
    expect(copy.dropped.mappings).toEqual([
      { lineId: line(copy, "Home").line.id, categoryId: "cat-utilities" },
    ]);
  });

  it("leaves out Luis, who left after being allocated 10 % of Free, which is flagged until it adds up again", async () => {
    const { plans, copyInto } = await world({
      parts: {
        capacities: [
          { memberId: "member-ana", amount: 160_000_000n },
          { memberId: "member-juan", amount: 240_000_000n },
          { memberId: "member-luis", amount: 50_000_000n },
        ],
        allocations: [
          { lineId: "line-free", memberId: "member-ana", value: 4200n },
          { lineId: "line-free", memberId: "member-juan", value: 4800n },
          { lineId: "line-free", memberId: "member-luis", value: 1000n },
        ],
      },
    });
    const copy = unwrap(await copyInto("2026-12"));
    expect(line(copy, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [
        { memberId: "member-ana", value: 4200n, assigned: null },
        { memberId: "member-juan", value: 4800n, assigned: null },
      ],
      invalid: true,
    });
    const stored = await plans.contents(copy.view.plan.id);
    expect(stored.capacities.map((c) => c.memberId)).toEqual(["member-ana", "member-juan"]);
  });

  it("keeps the accounts of current members that still qualify and leaves out a line left without one (P10)", async () => {
    // Marta and Luis are not members here: Ana's and Juan's accounts stay, whoever copies; Marta's and Luis's go.
    const { copyInto } = await world({ parts: savingsParts });
    const copy = unwrap(await copyInto("2026-12"));
    expect(copy.view.figures.lines.map((l) => [l.line.name, l.line.savingsAccountIds])).toEqual([
      ["Savings", ["acc-savings", "acc-juan-savings"]],
    ]);
    expect(copy.dropped).toEqual({
      mappings: [],
      savingsAccounts: [
        { lineId: line(copy, "Savings").line.id, accountId: "acc-marta-savings" },
        { lineId: line(copy, "Savings").line.id, accountId: "acc-old-savings" },
        { lineId: line(copy, "Savings").line.id, accountId: "acc-usd-savings" },
        { lineId: line(copy, "Savings").line.id, accountId: "acc-bank" },
      ],
      lines: [
        { originLineId: "line-reserve", name: "Reserve" },
        { originLineId: "line-trip", name: "Trip" },
      ],
    });
  });

  it("keeps Marta's account once Marta is a registered member, and still drops the archived, USD and BANK ones (P10)", async () => {
    const { copyInto } = await world({ members: [...ANA_AND_JUAN, MARTA], parts: savingsParts });
    const copy = unwrap(await copyInto("2026-12"));
    expect(line(copy, "Savings").line.savingsAccountIds).toEqual([
      "acc-savings",
      "acc-juan-savings",
      "acc-marta-savings",
    ]);
    expect(copy.dropped.savingsAccounts).toEqual([
      { lineId: line(copy, "Savings").line.id, accountId: "acc-old-savings" },
      { lineId: line(copy, "Savings").line.id, accountId: "acc-usd-savings" },
      { lineId: line(copy, "Savings").line.id, accountId: "acc-bank" },
    ]);
    expect(copy.dropped.lines.map((l) => l.name)).toEqual(["Reserve", "Trip"]);
  });

  it("keeps Ana's account when Juan, an ADMIN, makes the copy: the caller's identity plays no part (P10)", async () => {
    const admins = [memberOf("Ana", "OWNER", 0), memberOf("Juan", "ADMIN", 1)];
    const { copyInto } = await world({ members: admins, parts: savingsParts });
    const copy = unwrap(await copyInto("2026-12", "u-juan"));
    expect(line(copy, "Savings").line.savingsAccountIds).toEqual(["acc-savings", "acc-juan-savings"]);
    expect(copy.view.plan.createdBy).toBe("u-juan");
  });

  it("lets only owners and admins copy, refuses a period that has a plan, and an archived space", async () => {
    const { copyInto, spaces, plans } = await world();
    expect(codeOf(await copyInto("2026-12", "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await copyInto("2026-12", "u-marta"))).toBe("SpaceNotFound");
    expect(codeOf(await copyInto("2026-11"))).toBe("PlanAlreadyExists");
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await copyInto("2026-12"))).toBe("SpaceArchived");
    expect(plans.plans).toHaveLength(1);
  });

  it("answers PlanAlreadyExists when the unique index decides a concurrent copy of the period", async () => {
    const { copyInto, plans } = await world();
    plans.add = async () => false;
    expect(codeOf(await copyInto("2026-12"))).toBe("PlanAlreadyExists");
  });
});
