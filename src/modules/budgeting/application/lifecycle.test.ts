import { describe, expect, it } from "vitest";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, budgetingWorld, HOUSEHOLD, NOW } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { memberOf, type InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
import type { LineAllocation } from "../domain/allocation";
import type { BudgetLine } from "../domain/budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createActivateBudgetPlan, createCloseBudgetPlan } from "./plan-lifecycle";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");

/** HU-E6-07 Background: the reference plan for 2026-11 in Household, DRAFT, Ana 1,600,000 and Juan 2,400,000 COP. */
const world = async (parts: { lines?: BudgetLine[]; allocations?: LineAllocation[]; juan?: bigint } = {}) => {
  const w = budgetingWorld({ members: ANA_AND_JUAN });
  const deps = { ...w.deps, statuses: w.plans };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: parts.juan ?? 240_000_000n },
    ],
    lines: parts.lines ?? referenceLines(),
    allocations: parts.allocations ?? [],
  });
  const input = (userId = "u-ana", expectedVersion: number | null = null) => ({
    spaceId: HOUSEHOLD,
    userId,
    planId: plan.id,
    expectedVersion,
  });
  const status = async () => (await w.plans.find(HOUSEHOLD, plan.id))?.status;
  const version = async () => (await w.plans.find(HOUSEHOLD, plan.id))?.version;
  return {
    ...w,
    plan,
    input,
    status,
    version,
    activate: createActivateBudgetPlan(deps),
    close: createCloseBudgetPlan(deps),
  };
};

/** Luis (ADMIN) and Sofi (VIEWER) join Household once the plan exists; neither has a capacity. */
const joinLuisAndSofi = async (spaces: InMemorySpaceStore) => {
  await spaces.addMember(HOUSEHOLD, memberOf("Luis", "ADMIN", 4));
  await spaces.addMember(HOUSEHOLD, memberOf("Sofi", "VIEWER", 2));
};

describe("ActivateBudgetPlan (HU-E6-07)", () => {
  it("activates the valid reference plan and answers it with its new status and version", async () => {
    const { activate, input, status } = await world();
    const view = unwrap(await activate(input("u-ana", 1)));
    expect([view.plan.status, view.plan.version, await status()]).toEqual(["ACTIVE", 2, "ACTIVE"]);
    expect(view.figures.lines).toHaveLength(4);
  });

  it("refuses a plan whose Free percentages sum to 99 %, naming the line Free", async () => {
    const lines = referenceLines().map((l) =>
      l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l,
    );
    const allocations = [
      { lineId: "line-free", memberId: "member-ana", value: 4200n },
      { lineId: "line-free", memberId: "member-juan", value: 5700n },
    ];
    const { activate, input, status } = await world({ lines, allocations });
    expect(await activate(input())).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { lineIds: ["line-free"] } },
    });
    expect(await status()).toBe("DRAFT");
  });

  it("refuses a plan whose capacity was reduced: Juan at 2,000,000 COP", async () => {
    const { activate, input, status } = await world({ juan: 200_000_000n });
    expect(codeOf(await activate(input()))).toBe("PlanExceedsCapacity");
    expect(await status()).toBe("DRAFT");
  });

  it("counts only the capacity of the current members: one who left makes no room for the lines (P7)", async () => {
    // Juan at 2,000,000 COP leaves the 4,000,000 COP of lines 400,000 COP short; Luis's 400,000 COP row fills the gap.
    const joined = async () => {
      const w = await world({ juan: 200_000_000n });
      await w.spaces.addMember(HOUSEHOLD, memberOf("Luis", "MEMBER", 4));
      w.plans.seed(w.plan.id, { capacities: [{ memberId: "member-luis", amount: 40_000_000n }] });
      return w;
    };
    const present = await joined();
    expect(unwrap(await present.activate(present.input())).figures.unallocated).toBe(0n);
    const left = await joined();
    expect(await left.spaces.markLeft(HOUSEHOLD, "member-luis", "USER", NOW)).toBe(true);
    expect(codeOf(await left.activate(left.input()))).toBe("PlanExceedsCapacity");
    expect(await left.status()).toBe("DRAFT");
  });

  it("lets an ADMIN activate and refuses a VIEWER, by the matrix alone (plan.manage)", async () => {
    const { activate, input, spaces, status } = await world();
    await joinLuisAndSofi(spaces);
    expect(codeOf(await activate(input("u-sofi")))).toBe("InsufficientRole");
    expect(await status()).toBe("DRAFT");
    expect(unwrap(await activate(input("u-luis"))).plan.status).toBe("ACTIVE");
    expect(await status()).toBe("ACTIVE");
  });

  it("activates only a DRAFT plan, only for owners and admins, and honours If-Match", async () => {
    const { activate, input } = await world();
    expect(codeOf(await activate(input("u-juan")))).toBe("InsufficientRole");
    expect(codeOf(await activate(input("u-ana", 7)))).toBe("PreconditionFailed");
    unwrap(await activate(input()));
    expect(codeOf(await activate(input()))).toBe("InvalidPlanTransition");
    expect(codeOf(await activate({ ...input(), planId: "budget-404" }))).toBe("BudgetPlanNotFound");
  });

  it("answers InvalidPlanTransition for an ACTIVE and for a CLOSED plan, naming the move (P12)", async () => {
    const { activate, close, input } = await world();
    unwrap(await activate(input()));
    expect(await activate(input())).toEqual({
      ok: false,
      error: { code: "InvalidPlanTransition", details: { from: "ACTIVE", to: "ACTIVE" } },
    });
    unwrap(await close(input()));
    expect(await activate(input())).toEqual({
      ok: false,
      error: { code: "InvalidPlanTransition", details: { from: "CLOSED", to: "ACTIVE" } },
    });
  });

  it("gives the plan exactly one version per transition (P9)", async () => {
    const { activate, version, input } = await world();
    expect(await version()).toBe(1);
    expect(unwrap(await activate(input("u-ana", 1))).plan.version).toBe(2);
    expect(await version()).toBe(2);
  });

  it("changes nothing when If-Match is stale: the plan stays DRAFT at its version", async () => {
    const { activate, input, status, version } = await world();
    expect(codeOf(await activate(input("u-ana", 0)))).toBe("PreconditionFailed");
    expect(codeOf(await activate(input("u-ana", 2)))).toBe("PreconditionFailed");
    expect([await status(), await version()]).toEqual(["DRAFT", 1]);
  });

  it("answers SpaceNotFound to a stranger, SpaceArchived in an archived space and BudgetPlanNotFound for any other plan", async () => {
    const { activate, input, spaces, status } = await world();
    expect(codeOf(await activate(input("u-marta")))).toBe("SpaceNotFound");
    for (const planId of ["budget-404", "not-a-uuid", ""]) {
      expect(codeOf(await activate({ ...input(), planId }))).toBe("BudgetPlanNotFound");
    }
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await activate(input()))).toBe("SpaceArchived");
    expect(await status()).toBe("DRAFT");
  });
});

describe("CloseBudgetPlan (HU-E6-07)", () => {
  it("closes an ACTIVE plan", async () => {
    const { activate, close, input, status } = await world();
    unwrap(await activate(input()));
    const view = unwrap(await close(input()));
    expect([view.plan.status, view.plan.version, await status()]).toEqual(["CLOSED", 3, "CLOSED"]);
  });

  it("closes only an ACTIVE plan: a DRAFT one answers InvalidPlanTransition", async () => {
    const { close, input, status } = await world();
    expect(await close(input())).toEqual({
      ok: false,
      error: { code: "InvalidPlanTransition", details: { from: "DRAFT", to: "CLOSED" } },
    });
    expect(await status()).toBe("DRAFT");
  });

  it("never reopens a CLOSED plan, nor closes it twice", async () => {
    const { activate, close, input } = await world();
    unwrap(await activate(input()));
    unwrap(await close(input()));
    expect([codeOf(await activate(input())), codeOf(await close(input()))]).toEqual([
      "InvalidPlanTransition",
      "InvalidPlanTransition",
    ]);
    expect(await close(input())).toEqual({
      ok: false,
      error: { code: "InvalidPlanTransition", details: { from: "CLOSED", to: "CLOSED" } },
    });
  });

  it("closes an ACTIVE plan whose figures no longer hold: only activation checks them (P13)", async () => {
    const { activate, close, input, plans, plan } = await world();
    unwrap(await activate(input()));
    plans.seed(plan.id, { capacities: [{ memberId: "member-juan", amount: 0n }] });
    expect(unwrap(await close(input())).figures.unallocated).toBe(-240_000_000n);
  });

  it("gives the plan exactly one version per transition and honours If-Match (P9)", async () => {
    const { activate, close, input } = await world();
    expect(unwrap(await activate(input("u-ana", 1))).plan.version).toBe(2);
    expect(unwrap(await close(input("u-ana", 2))).plan.version).toBe(3);
  });

  it("changes nothing when If-Match is stale: the plan stays ACTIVE at its version", async () => {
    const { activate, close, input, status, version } = await world();
    unwrap(await activate(input()));
    expect(codeOf(await close(input("u-ana", 1)))).toBe("PreconditionFailed");
    expect(codeOf(await close(input("u-ana", 3)))).toBe("PreconditionFailed");
    expect([await status(), await version()]).toEqual(["ACTIVE", 2]);
  });

  it("lets an ADMIN close and refuses a VIEWER, by the matrix alone (plan.manage)", async () => {
    const { activate, close, input, spaces, status } = await world();
    await joinLuisAndSofi(spaces);
    unwrap(await activate(input()));
    expect(codeOf(await close(input("u-sofi")))).toBe("InsufficientRole");
    expect(await status()).toBe("ACTIVE");
    expect(unwrap(await close(input("u-luis"))).plan.status).toBe("CLOSED");
    expect(await status()).toBe("CLOSED");
  });

  it("lets only owners and admins close", async () => {
    const { activate, close, input } = await world();
    unwrap(await activate(input()));
    expect(codeOf(await close(input("u-juan")))).toBe("InsufficientRole");
  });

  it("answers SpaceNotFound to a stranger, SpaceArchived in an archived space and BudgetPlanNotFound for any other plan", async () => {
    const { activate, close, input, spaces, status } = await world();
    unwrap(await activate(input()));
    expect(codeOf(await close(input("u-marta")))).toBe("SpaceNotFound");
    for (const planId of ["budget-404", "not-a-uuid", ""]) {
      expect(codeOf(await close({ ...input(), planId }))).toBe("BudgetPlanNotFound");
    }
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await close(input()))).toBe("SpaceArchived");
    expect(await status()).toBe("ACTIVE");
  });
});
