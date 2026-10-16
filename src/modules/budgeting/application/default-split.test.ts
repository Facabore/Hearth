import { describe, expect, it } from "vitest";
import type { SpaceId, SpaceMember } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import {
  BUDGET_MEMBERS,
  budgetingWorld,
  HOUSEHOLD,
  householdCategories,
  NOW,
} from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import type { LineAllocation } from "../domain/allocation";
import type { BudgetLine } from "../domain/budget-line";
import type { PlanStatus } from "../domain/plan";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createResolveDefaultSplit, defaultSplitOf, type DefaultSplitView } from "./default-split";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");
const pesos = (n: number) => BigInt(n) * 100n;
const ALL_METHODS = ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"];

/**
 * HU-E6-08 Background: Household's reference plan for 2026-11, ACTIVE unless `status` says otherwise, Ana
 * 1,600,000 and Juan 2,400,000 COP, Groceries mapped to Home (PROPORTIONAL, 40 % / 60 %), Free the catch-all line.
 */
const world = async (
  options: {
    readonly status?: PlanStatus;
    readonly lines?: BudgetLine[];
    readonly allocations?: LineAllocation[];
    readonly members?: readonly SpaceMember[];
  } = {},
) => {
  const w = budgetingWorld({ members: options.members ?? ANA_AND_JUAN });
  const deps = { ...w.deps, categories: householdCategories };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: options.lines ?? referenceLines(),
    mappings: [{ lineId: "line-home", categoryId: "cat-groceries" }],
    allocations: options.allocations ?? [],
  });
  await w.plans.setStatus(plan.id, options.status ?? "ACTIVE");
  const resolve = createResolveDefaultSplit(deps);
  const preview = (
    categoryId: string,
    ask: { readonly date?: string; readonly amount?: bigint | null; readonly userId?: string } = {},
  ) =>
    resolve({
      spaceId: HOUSEHOLD,
      userId: ask.userId ?? "u-ana",
      categoryId,
      date: (ask.date ?? "2026-11-08") as LocalDate,
      amount: ask.amount === undefined ? pesos(2_000_000) : ask.amount,
    });
  return { ...w, deps, plan, preview };
};
const sharesOf = (view: DefaultSplitView) => view.shares?.map((s) => [s.memberId, s.amount]) ?? null;
const withRule = (name: string, allocationRule: BudgetLine["allocationRule"]) =>
  referenceLines().map((l) => (l.name === name ? { ...l, allocationRule } : l));
const groceries = {
  spaceId: HOUSEHOLD as SpaceId,
  currency: "COP",
  categoryId: "cat-groceries",
  date: "2026-11-08" as LocalDate,
};

describe("ResolveDefaultSplit (HU-E6-08, spec 5.3)", () => {
  it("defaults a Groceries expense to BY_ALLOCATION by Home: 800,000 and 1,200,000 COP of 2,000,000 (golden)", async () => {
    const { preview } = await world();
    expect(unwrap(await preview("cat-groceries"))).toEqual({
      method: "BY_ALLOCATION",
      availableMethods: ALL_METHODS,
      lineId: "line-home",
      currency: "COP",
      shares: [
        { memberId: "member-ana", amount: pesos(800_000) },
        { memberId: "member-juan", amount: pesos(1_200_000) },
      ],
    });
  });

  it("splits by fixed amounts: Home FIXED 490,000 / 980,000 COP shares 300,000 COP as 100,000 / 200,000", async () => {
    const allocations = [
      { lineId: "line-home", memberId: "member-ana", value: pesos(490_000) },
      { lineId: "line-home", memberId: "member-juan", value: pesos(980_000) },
    ];
    const { preview } = await world({ lines: withRule("Home", "FIXED"), allocations });
    expect(sharesOf(unwrap(await preview("cat-groceries", { amount: pesos(300_000) })))).toEqual([
      ["member-ana", pesos(100_000)],
      ["member-juan", pesos(200_000)],
    ]);
  });

  it("defaults an unmapped Outings expense to EQUAL when the catch-all Free is NONE, without offering BY_ALLOCATION", async () => {
    const { preview } = await world({ lines: withRule("Free", "NONE") });
    expect(unwrap(await preview("cat-outings", { amount: pesos(50_000) }))).toEqual({
      method: "EQUAL",
      availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: "line-free",
      currency: "COP",
      shares: [
        { memberId: "member-ana", amount: pesos(25_000) },
        { memberId: "member-juan", amount: pesos(25_000) },
      ],
    });
  });

  it.each<PlanStatus>(["DRAFT", "CLOSED"])(
    "defaults to EQUAL while the plan is %s: only ACTIVE plans drive splits",
    async (status) => {
      const { preview } = await world({ status });
      const view = unwrap(await preview("cat-groceries"));
      expect([view.method, view.lineId, sharesOf(view)]).toEqual([
        "EQUAL",
        null,
        [
          ["member-ana", pesos(1_000_000)],
          ["member-juan", pesos(1_000_000)],
        ],
      ]);
    },
  );

  it("defaults to EQUAL on a date no plan covers, and while Home's allocation does not hold", async () => {
    const { preview } = await world();
    expect(unwrap(await preview("cat-groceries", { date: "2026-12-05" }))).toMatchObject({
      method: "EQUAL",
      lineId: null,
    });
    const allocations = [
      { lineId: "line-home", memberId: "member-ana", value: 4200n },
      { lineId: "line-home", memberId: "member-juan", value: 5700n },
    ];
    const broken = await world({ lines: withRule("Home", "PERCENT"), allocations });
    expect(unwrap(await broken.preview("cat-groceries"))).toMatchObject({
      method: "EQUAL",
      lineId: "line-home",
    });
  });

  it("defaults to EQUAL with no line when the plan maps the category to none and holds no catch-all line", async () => {
    const lines = referenceLines().map((l) => ({ ...l, isCatchAll: false }));
    const { preview } = await world({ lines });
    const view = unwrap(await preview("cat-outings"));
    expect([view.method, view.lineId, sharesOf(view)]).toEqual([
      "EQUAL",
      null,
      [
        ["member-ana", pesos(1_000_000)],
        ["member-juan", pesos(1_000_000)],
      ],
    ]);
    expect(unwrap(await preview("cat-groceries"))).toMatchObject({
      method: "BY_ALLOCATION",
      lineId: "line-home",
    });
  });

  it("weighs only members with a positive assigned amount: Sofi and Pedro hold no capacity, Pedro alone a FIXED Home", async () => {
    const proportional = await world({ members: BUDGET_MEMBERS });
    expect(sharesOf(unwrap(await proportional.preview("cat-groceries")))).toEqual([
      ["member-ana", pesos(800_000)],
      ["member-juan", pesos(1_200_000)],
    ]);
    const allocations = [{ lineId: "line-home", memberId: "member-pedro", value: pesos(1_470_000) }];
    const pedro = await world({ members: BUDGET_MEMBERS, lines: withRule("Home", "FIXED"), allocations });
    expect(sharesOf(unwrap(await pedro.preview("cat-groceries")))).toEqual([
      ["member-pedro", pesos(2_000_000)],
    ]);
  });

  it("previews no shares without an amount", async () => {
    const { preview } = await world();
    expect(unwrap(await preview("cat-groceries", { amount: null })).shares).toBeNull();
  });

  it("answers any member, Sofi the VIEWER included, and refuses other spaces' categories and non-members", async () => {
    const { preview } = await world({ members: BUDGET_MEMBERS });
    expect(codeOf(await preview("cat-groceries", { userId: "u-sofi" }))).toBe("ok");
    expect(codeOf(await preview("cat-old"))).toBe("ok");
    expect(codeOf(await preview("cat-personal"))).toBe("CategoryNotInSpace");
    expect(codeOf(await preview("cat-unknown"))).toBe("CategoryNotInSpace");
    expect(codeOf(await preview("cat-groceries", { userId: "u-marta" }))).toBe("SpaceNotFound");
  });

  it("answers an unknown, a malformed and an empty category id as CategoryNotInSpace alike (ruling P6)", async () => {
    const { preview } = await world();
    for (const categoryId of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", ""]) {
      expect(codeOf(await preview(categoryId))).toBe("CategoryNotInSpace");
    }
  });

  it("still answers in an archived space: a preview records nothing, so it is space.read", async () => {
    const { preview, spaces } = await world();
    await spaces.archive(HOUSEHOLD);
    expect(unwrap(await preview("cat-groceries"))).toMatchObject({
      method: "BY_ALLOCATION",
      lineId: "line-home",
    });
  });
});

describe("defaultSplitOf (what the ledger's DefaultSplitSource answers)", () => {
  it("weighs the current members only: once Juan left, Ana alone carries Home", async () => {
    const { deps, spaces } = await world();
    expect(await defaultSplitOf(deps, groceries)).toEqual({
      method: "BY_ALLOCATION",
      lineId: "line-home",
      weights: [
        { memberId: "member-ana", weight: 58_800_000n },
        { memberId: "member-juan", weight: 88_200_000n },
      ],
    });
    await spaces.markLeft(HOUSEHOLD, "member-juan", "USER", NOW);
    expect((await defaultSplitOf(deps, groceries)).weights).toEqual([
      { memberId: "member-ana", weight: 147_000_000n },
    ]);
  });

  it("answers EQUAL, never an empty BY_ALLOCATION, once the only members with a positive assigned amount left", async () => {
    const { deps, spaces } = await world({ members: BUDGET_MEMBERS });
    await spaces.markLeft(HOUSEHOLD, "member-ana", "USER", NOW);
    await spaces.markLeft(HOUSEHOLD, "member-juan", "USER", NOW);
    expect(await defaultSplitOf(deps, groceries)).toEqual({
      method: "EQUAL",
      lineId: "line-home",
      weights: [
        { memberId: "member-sofi", weight: 1n },
        { memberId: "member-pedro", weight: 1n },
      ],
    });
  });

  it("answers EQUAL, naming nobody who left, once the only holder of a FIXED Home left", async () => {
    const allocations = [{ lineId: "line-home", memberId: "member-pedro", value: pesos(1_470_000) }];
    const { deps, spaces } = await world({
      members: BUDGET_MEMBERS,
      lines: withRule("Home", "FIXED"),
      allocations,
    });
    expect((await defaultSplitOf(deps, groceries)).weights).toEqual([
      { memberId: "member-pedro", weight: pesos(1_470_000) },
    ]);
    await spaces.markLeft(HOUSEHOLD, "member-pedro", "GUEST", NOW);
    expect(await defaultSplitOf(deps, groceries)).toEqual({
      method: "EQUAL",
      lineId: "line-home",
      weights: [
        { memberId: "member-ana", weight: 1n },
        { memberId: "member-juan", weight: 1n },
        { memberId: "member-sofi", weight: 1n },
      ],
    });
  });

  it("returns positive weights only: a PERCENT Home of 100 % / 0 % weighs Ana alone", async () => {
    const allocations = [
      { lineId: "line-home", memberId: "member-ana", value: 10_000n },
      { lineId: "line-home", memberId: "member-juan", value: 0n },
    ];
    const { deps } = await world({ lines: withRule("Home", "PERCENT"), allocations });
    expect(await defaultSplitOf(deps, groceries)).toEqual({
      method: "BY_ALLOCATION",
      lineId: "line-home",
      weights: [{ memberId: "member-ana", weight: 147_000_000n }],
    });
  });
});
