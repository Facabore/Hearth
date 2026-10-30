import { describe, expect, it } from "vitest";
import type { SpaceMember } from "@/modules/spaces/application";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import {
  BUDGET_MEMBERS,
  budgetingWorld,
  HOUSEHOLD,
  NOW,
  savingsAccounts,
} from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import type { AllocationInput } from "../domain/allocation";
import { createAllocateBudgetLine } from "./allocate-budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createGetBudgetPlan } from "./get-budget-plan";
import type { BudgetPlanView } from "./plan-view";
import { createUpdateBudgetLine } from "./update-budget-line";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");
const percent = (ana: number, juan: number): AllocationInput => ({
  rule: "PERCENT",
  members: [
    { memberId: "member-ana", basisPoints: ana },
    { memberId: "member-juan", basisPoints: juan },
  ],
});
const fixed = (ana: number, juan: number): AllocationInput => ({
  rule: "FIXED",
  members: [
    { memberId: "member-ana", amount: cop(ana) },
    { memberId: "member-juan", amount: cop(juan) },
  ],
});

/** HU-E6-05 Background: the reference plan for 2026-11 with capacities Ana 1,600,000 COP and Juan 2,400,000 COP. */
const world = async (members: readonly SpaceMember[] = ANA_AND_JUAN) => {
  const w = budgetingWorld({ members });
  const deps = { ...w.deps, allocations: w.plans, lines: w.plans, savingsAccounts };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: referenceLines(),
  });
  const allocate = createAllocateBudgetLine(deps);
  const allocateLine = (line: string, allocation: AllocationInput, userId = "u-ana") =>
    allocate({
      spaceId: HOUSEHOLD,
      userId,
      planId: plan.id,
      lineId: `line-${line}`,
      expectedVersion: null,
      allocation,
    });
  const read = () => createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id });
  return { ...w, deps, plan, allocateLine, read };
};
const line = (view: BudgetPlanView, name: string) => view.figures.lines.find((l) => l.line.name === name)!;
const assigned = (view: BudgetPlanView, name: string) =>
  line(view, name).allocation.members.map((m) => [m.memberId, m.assigned]);

describe("AllocateBudgetLine (HU-E6-05)", () => {
  it("allocates Home proportionally, the default: Ana 588,000 and Juan 882,000 COP (golden)", async () => {
    const { allocateLine } = await world();
    const view = unwrap(await allocateLine("home", { rule: "PROPORTIONAL" }));
    expect(assigned(view, "Home")).toEqual([
      ["member-ana", 58_800_000n],
      ["member-juan", 88_200_000n],
    ]);
  });

  it("allocates Free at 42 % / 58 %: Ana 306,600 and Juan 423,400 COP (golden)", async () => {
    const { allocateLine } = await world();
    const view = unwrap(await allocateLine("free", percent(4200, 5800)));
    expect([line(view, "Free").line.allocationRule, assigned(view, "Free")]).toEqual([
      "PERCENT",
      [
        ["member-ana", 30_660_000n],
        ["member-juan", 42_340_000n],
      ],
    ]);
  });

  it("allocates Savings by fixed amounts: Ana 200,000 and Juan 400,000 COP", async () => {
    const { allocateLine } = await world();
    const view = unwrap(await allocateLine("savings", fixed(200_000, 400_000)));
    expect(assigned(view, "Savings")).toEqual([
      ["member-ana", 20_000_000n],
      ["member-juan", 40_000_000n],
    ]);
  });

  it("refuses values that do not add up: Free at 42 % / 57 % and Savings at 200,000 / 350,000 COP", async () => {
    const { allocateLine } = await world();
    expect(codeOf(await allocateLine("free", percent(4200, 5700)))).toBe("InvalidAllocation");
    expect(codeOf(await allocateLine("savings", fixed(200_000, 350_000)))).toBe("InvalidAllocation");
  });

  it("leaves Free unassigned as group money with NONE, still reporting planned, spent and available", async () => {
    const { allocateLine, spending } = await world();
    spending.byCategory = [{ categoryId: "cat-entertainment", amount: 25_000_000n }];
    const free = line(unwrap(await allocateLine("free", { rule: "NONE" })), "Free");
    expect([free.allocation, free.spent, free.available]).toEqual([
      { rule: "NONE", members: [], invalid: false },
      25_000_000n,
      48_000_000n,
    ]);
  });

  it("flags a PROPORTIONAL line while every capacity is 0", async () => {
    const { allocateLine, plans, plan } = await world();
    plans.seed(plan.id, {
      capacities: [
        { memberId: "member-ana", amount: 0n },
        { memberId: "member-juan", amount: 0n },
      ],
    });
    expect(
      line(unwrap(await allocateLine("home", { rule: "PROPORTIONAL" })), "Home").allocation.invalid,
    ).toBe(true);
  });

  it("supersedes the earlier values when a line is allocated again (D8, Review Focus 6)", async () => {
    const { allocateLine, plans } = await world();
    unwrap(await allocateLine("free", percent(4200, 5800)));
    unwrap(await allocateLine("free", percent(5000, 5000)));
    unwrap(await allocateLine("free", { rule: "PROPORTIONAL" }));
    expect(plans.allocations.map((r) => [r.allocation.value, r.supersededAt])).toEqual([
      [4200n, NOW],
      [5800n, NOW],
      [5000n, NOW],
      [5000n, NOW],
    ]);
  });

  it("supersedes only the allocated line's values, and every one of them when it goes back to NONE (P1)", async () => {
    const { allocateLine, plans, read } = await world();
    unwrap(await allocateLine("free", percent(4200, 5800)));
    unwrap(await allocateLine("savings", fixed(200_000, 400_000)));
    unwrap(await allocateLine("free", { rule: "NONE" }));
    expect(
      plans.allocations.map((r) => [r.allocation.lineId, r.allocation.value, r.supersededAt === null]),
    ).toEqual([
      ["line-free", 4200n, false],
      ["line-free", 5800n, false],
      ["line-savings", 20_000_000n, true],
      ["line-savings", 40_000_000n, true],
    ]);
    expect(assigned(unwrap(await read()), "Savings")).toEqual([
      ["member-ana", 20_000_000n],
      ["member-juan", 40_000_000n],
    ]);
  });

  it("allocates to the guest Pedro like anyone, and refuses Marta (D15, Review Focus 2)", async () => {
    const { allocateLine } = await world(BUDGET_MEMBERS);
    const pedro: AllocationInput = {
      rule: "FIXED",
      members: [{ memberId: "member-pedro", amount: cop(600_000) }],
    };
    expect(assigned(unwrap(await allocateLine("savings", pedro)), "Savings")).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
      ["member-sofi", 0n],
      ["member-pedro", 60_000_000n],
    ]);
    const marta: AllocationInput = {
      rule: "PERCENT",
      members: [{ memberId: "member-marta-personal", basisPoints: 10_000 }],
    };
    expect(codeOf(await allocateLine("free", marta))).toBe("NotASpaceMember");
  });

  it("refuses a share for Sofi the VIEWER and writes nothing, and allocates among the others (#217, ruling P261)", async () => {
    const { allocateLine, read } = await world(BUDGET_MEMBERS);
    const withSofi: AllocationInput = {
      rule: "PERCENT",
      members: [
        { memberId: "member-ana", basisPoints: 4200 },
        { memberId: "member-juan", basisPoints: 4800 },
        { memberId: "member-sofi", basisPoints: 1000 },
      ],
    };
    expect(await allocateLine("free", withSofi)).toEqual({
      ok: false,
      error: { code: "ViewerCannotHoldAllocation", details: { memberId: "member-sofi" } },
    });
    expect(line(unwrap(await read()), "Free").line.allocationRule).toBe("PROPORTIONAL");
    expect(assigned(unwrap(await allocateLine("free", percent(4200, 5800))), "Free")).toEqual([
      ["member-ana", 30_660_000n],
      ["member-juan", 42_340_000n],
      ["member-sofi", 0n],
      ["member-pedro", 0n],
    ]);
  });

  it("flags Free once Juan, allocated 58 %, has left, until it is allocated again (Review Focus 2)", async () => {
    const { allocateLine, spaces, read } = await world();
    unwrap(await allocateLine("free", percent(4200, 5800)));
    await spaces.markLeft(HOUSEHOLD, "member-juan", "USER", NOW);
    const view = unwrap(await read());
    expect(line(view, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [{ memberId: "member-ana", value: 4200n, assigned: null }],
      invalid: true,
    });
    expect(codeOf(await allocateLine("free", percent(4200, 5800)))).toBe("NotASpaceMember");
    const anaAlone: AllocationInput = {
      rule: "PERCENT",
      members: [{ memberId: "member-ana", basisPoints: 10_000 }],
    };
    expect(line(unwrap(await allocateLine("free", anaAlone)), "Free").allocation.invalid).toBe(false);
  });

  it("flags a FIXED line once the guest Pedro has left, leaves PROPORTIONAL lines whole, and keeps his row (P7)", async () => {
    const { allocateLine, spaces, plans, read } = await world(BUDGET_MEMBERS);
    const pedro: AllocationInput = {
      rule: "FIXED",
      members: [{ memberId: "member-pedro", amount: cop(600_000) }],
    };
    unwrap(await allocateLine("savings", pedro));
    await spaces.markLeft(HOUSEHOLD, "member-pedro", "GUEST", NOW);
    const view = unwrap(await read());
    expect([line(view, "Savings").allocation.invalid, line(view, "Home").allocation.invalid]).toEqual([
      true,
      false,
    ]);
    expect(plans.allocations.map((r) => [r.allocation.memberId, r.supersededAt])).toEqual([
      ["member-pedro", null],
    ]);
    const anaAlone: AllocationInput = {
      rule: "FIXED",
      members: [{ memberId: "member-ana", amount: cop(600_000) }],
    };
    const again = unwrap(await allocateLine("savings", anaAlone));
    expect(line(again, "Savings").allocation.invalid).toBe(false);
    expect(plans.allocations.map((r) => [r.allocation.memberId, r.supersededAt])).toEqual([
      ["member-pedro", NOW],
      ["member-ana", null],
    ]);
  });

  it("reads a FIXED line as invalid once its planned amount changes, until it is allocated again (N6)", async () => {
    const { allocateLine, deps, plan, read } = await world();
    unwrap(await allocateLine("free", fixed(300_000, 430_000)));
    const update = createUpdateBudgetLine(deps);
    const lowered = unwrap(
      await update({
        spaceId: HOUSEHOLD,
        userId: "u-ana",
        planId: plan.id,
        lineId: "line-free",
        expectedVersion: null,
        changes: { plannedAmount: cop(700_000) },
      }),
    );
    expect(line(lowered, "Free").allocation).toEqual({
      rule: "FIXED",
      members: [
        { memberId: "member-ana", value: 30_000_000n, assigned: null },
        { memberId: "member-juan", value: 43_000_000n, assigned: null },
      ],
      invalid: true,
    });
    expect(line(unwrap(await read()), "Free").allocation.invalid).toBe(true);
    const again = unwrap(await allocateLine("free", fixed(300_000, 400_000)));
    expect(assigned(again, "Free")).toEqual([
      ["member-ana", 30_000_000n],
      ["member-juan", 40_000_000n],
    ]);
  });

  it("lets only owners and admins allocate, and answers BudgetLineNotFound for unknown lines", async () => {
    const { allocateLine } = await world();
    expect(codeOf(await allocateLine("home", { rule: "NONE" }, "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await allocateLine("travel", { rule: "NONE" }))).toBe("BudgetLineNotFound");
  });

  it("writes nothing when it refuses: a line allocated earlier keeps its rule and its current values", async () => {
    const { allocateLine, plans } = await world();
    unwrap(await allocateLine("free", percent(4200, 5800)));
    const before = structuredClone(plans.allocations);
    const refused = [
      await allocateLine("free", percent(4200, 5700)),
      await allocateLine("free", fixed(300_000, 400_000)),
      await allocateLine("free", {
        rule: "FIXED",
        members: [{ memberId: "member-ana", amount: money(73_000_000n, "USD") }],
      }),
      await allocateLine("free", {
        rule: "PERCENT",
        members: [{ memberId: "member-marta-personal", basisPoints: 10_000 }],
      }),
      await allocateLine("free", { rule: "PERCENT", members: [] }),
    ];
    expect(refused.map(codeOf)).toEqual([
      "InvalidAllocation",
      "InvalidAllocation",
      "CurrencyMismatch",
      "NotASpaceMember",
      "InvalidAllocation",
    ]);
    expect(plans.allocations).toEqual(before);
    expect(plans.lines.find((r) => r.line.id === "line-free")?.line.allocationRule).toBe("PERCENT");
  });

  it("honours If-Match, and refuses a stale one, an unknown plan and a stranger without writing", async () => {
    const { deps, plan, plans } = await world();
    const allocate = createAllocateBudgetLine(deps);
    const input = {
      spaceId: HOUSEHOLD,
      userId: "u-ana",
      planId: plan.id,
      lineId: "line-free",
      expectedVersion: null,
      allocation: percent(4200, 5800),
    };
    const refused = [
      await allocate({ ...input, expectedVersion: plan.version + 6 }),
      await allocate({ ...input, planId: "not-a-plan" }),
      await allocate({ ...input, userId: "u-stranger" }),
    ];
    expect(refused.map(codeOf)).toEqual(["PreconditionFailed", "BudgetPlanNotFound", "SpaceNotFound"]);
    expect(plans.allocations).toEqual([]);
    const view = unwrap(await allocate({ ...input, expectedVersion: plan.version }));
    expect(view.plan.version).toBe(plan.version + 1);
  });
});
