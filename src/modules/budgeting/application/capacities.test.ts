import { describe, expect, it } from "vitest";
import type { SpaceId } from "@/modules/spaces/application";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { budgetingWorld, fixedIncome, HOUSEHOLD, NOW } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createSetMemberCapacities } from "./set-member-capacities";
import { createSuggestCapacity } from "./suggest-capacity";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);

/** HU-E6-02 Background: a DRAFT plan for 2026-11 in Household. */
const world = async (options: Parameters<typeof budgetingWorld>[0] = {}) => {
  const w = budgetingWorld(options);
  const create = createCreateBudgetPlan(w.deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  const set = createSetMemberCapacities({ ...w.deps, capacities: w.plans });
  const as = (userId: string, capacities: [string, number][], expectedVersion: number | null = null) =>
    set({
      spaceId: HOUSEHOLD,
      userId,
      planId: plan.id,
      expectedVersion,
      capacities: capacities.map(([memberId, pesos]) => ({ memberId, amount: cop(pesos) })),
    });
  return { ...w, plan, set, as };
};

describe("SetMemberCapacities (HU-E6-02)", () => {
  it("sets capacities that define the proportional ratio 40.00 % / 60.00 % (golden)", async () => {
    const { as } = await world();
    const view = unwrap(
      await as("u-ana", [
        ["member-ana", 1_600_000],
        ["member-juan", 2_400_000],
      ]),
    );
    expect(view.figures.totalCapacity).toBe(400_000_000n);
    expect(view.figures.capacities.map((c) => [c.memberId, c.amount, c.shareBasisPoints])).toEqual([
      ["member-ana", 160_000_000n, 4000],
      ["member-juan", 240_000_000n, 6000],
      ["member-sofi", 0n, 0],
      ["member-pedro", 0n, 0],
    ]);
    expect(view.plan.version).toBe(2);
  });

  it("keeps the members it does not list, and gives the guest Pedro a capacity (D15)", async () => {
    const { as } = await world();
    unwrap(
      await as("u-ana", [
        ["member-ana", 1_600_000],
        ["member-juan", 2_400_000],
      ]),
    );
    const view = unwrap(
      await as("u-ana", [
        ["member-juan", 2_000_000],
        ["member-pedro", 300_000],
      ]),
    );
    expect(view.figures.capacities.map((c) => c.amount)).toEqual([
      160_000_000n,
      200_000_000n,
      0n,
      30_000_000n,
    ]);
  });

  it("reports negative unallocated capacity once capacities fall below the planned lines", async () => {
    const { as, plans, plan } = await world();
    unwrap(
      await as("u-ana", [
        ["member-ana", 1_600_000],
        ["member-juan", 2_400_000],
      ]),
    );
    plans.seed(plan.id, { lines: [aLine("Home", 400_000_000n)] });
    const view = unwrap(await as("u-ana", [["member-juan", 2_000_000]]));
    expect([view.figures.totalCapacity, view.figures.unallocated]).toEqual([360_000_000n, -40_000_000n]);
  });

  it("rejects a negative capacity and a capacity for Marta, who is neither a member nor a guest", async () => {
    const { as } = await world();
    expect(codeOf(await as("u-ana", [["member-juan", -100_000]]))).toBe("InvalidCapacity");
    expect(codeOf(await as("u-ana", [["member-marta-personal", 100_000]]))).toBe("NotASpaceMember");
  });

  it("rejects a capacity in another currency than the space's, and a member listed twice", async () => {
    const { set, as, plan } = await world();
    const dollars = await set({
      spaceId: HOUSEHOLD,
      userId: "u-ana",
      planId: plan.id,
      expectedVersion: null,
      capacities: [{ memberId: "member-ana", amount: money(100n, "USD") }],
    });
    expect(codeOf(dollars)).toBe("CurrencyMismatch");
    expect(
      codeOf(
        await as("u-ana", [
          ["member-ana", 1],
          ["member-ana", 2],
        ]),
      ),
    ).toBe("InvalidCapacity");
  });

  it("writes nothing when an entry is refused, whatever the other entries say", async () => {
    const { as, plans, plan } = await world();
    unwrap(await as("u-ana", [["member-ana", 1_600_000]]));
    expect(
      codeOf(
        await as("u-ana", [
          ["member-ana", 1],
          ["member-marta-personal", 1],
        ]),
      ),
    ).toBe("NotASpaceMember");
    expect(plans.capacities.get(plan.id)).toEqual([{ memberId: "member-ana", amount: 160_000_000n }]);
  });

  it("lets Juan the MEMBER set only his own capacity, and Sofi the VIEWER none (D17)", async () => {
    const { as } = await world();
    expect(codeOf(await as("u-juan", [["member-juan", 2_400_000]]))).toBe("ok");
    expect(codeOf(await as("u-juan", [["member-ana", 1]]))).toBe("InsufficientRole");
    expect(
      codeOf(
        await as("u-juan", [
          ["member-juan", 1],
          ["member-ana", 1],
        ]),
      ),
    ).toBe("InsufficientRole");
    expect(codeOf(await as("u-sofi", [["member-sofi", 1]]))).toBe("InsufficientRole");
  });

  it("refuses Juan the MEMBER the guest Pedro's capacity, alone or with his own, and changes nothing", async () => {
    const { as, plans, plan } = await world();
    expect(codeOf(await as("u-juan", [["member-pedro", 300_000]]))).toBe("InsufficientRole");
    expect(
      codeOf(
        await as("u-juan", [
          ["member-juan", 2_400_000],
          ["member-pedro", 300_000],
        ]),
      ),
    ).toBe("InsufficientRole");
    expect(plans.capacities.get(plan.id)).toBeUndefined();
    expect(plans.plans[0]!.version).toBe(1);
  });

  it("refuses a capacity for a member who left, whose stored row stays but no longer counts (P7)", async () => {
    const { as, plans, plan, spaces } = await world();
    unwrap(
      await as("u-ana", [
        ["member-ana", 1_600_000],
        ["member-juan", 2_400_000],
      ]),
    );
    await spaces.markLeft(HOUSEHOLD, "member-juan", "USER", NOW);
    expect(codeOf(await as("u-ana", [["member-juan", 1]]))).toBe("NotASpaceMember");
    const view = unwrap(await as("u-ana", [["member-ana", 1_700_000]]));
    expect(view.figures.capacities.map((c) => c.memberId)).toEqual([
      "member-ana",
      "member-sofi",
      "member-pedro",
    ]);
    expect(view.figures.totalCapacity).toBe(170_000_000n);
    expect(plans.capacities.get(plan.id)).toContainEqual({ memberId: "member-juan", amount: 240_000_000n });
  });

  it("refuses Sofi the VIEWER a capacity above zero and writes nothing, and takes her zero (#217, ruling P261)", async () => {
    const { as, plans, plan } = await world();
    unwrap(await as("u-ana", [["member-ana", 1_600_000]]));
    const refused = await as("u-ana", [
      ["member-juan", 2_400_000],
      ["member-sofi", 100_000],
    ]);
    expect(refused).toEqual({
      ok: false,
      error: { code: "ViewerCannotHoldCapacity", details: { memberId: "member-sofi" } },
    });
    expect(plans.capacities.get(plan.id)).toEqual([{ memberId: "member-ana", amount: 160_000_000n }]);
    const view = unwrap(await as("u-ana", [["member-sofi", 0]]));
    expect(view.figures.capacities.map((c) => [c.memberId, c.amount])).toEqual([
      ["member-ana", 160_000_000n],
      ["member-juan", 0n],
      ["member-sofi", 0n],
      ["member-pedro", 0n],
    ]);
  });

  it("keeps a capacity stored before Sofi became a VIEWER until it is set to zero, and the others still save (P261)", async () => {
    const { as, plans, plan } = await world();
    // Sofi held 100,000 COP as a MEMBER; a role change never rewrites stored rows.
    plans.seed(plan.id, { capacities: [{ memberId: "member-sofi", amount: 10_000_000n }] });
    const others = unwrap(await as("u-ana", [["member-ana", 1_600_000]]));
    expect(others.figures.totalCapacity).toBe(170_000_000n);
    expect(codeOf(await as("u-ana", [["member-sofi", 100_000]]))).toBe("ViewerCannotHoldCapacity");
    const cleared = unwrap(await as("u-ana", [["member-sofi", 0]]));
    expect(cleared.figures.totalCapacity).toBe(160_000_000n);
  });

  it("lets Luis the ADMIN set anyone's capacity, the guest Pedro's included, and hides the space from Marta", async () => {
    const { as, plans, plan } = await world({
      members: [
        memberOf("Ana", "OWNER", 0),
        memberOf("Juan", "MEMBER", 1),
        memberOf("Luis", "ADMIN", 2),
        memberOf("Pedro", null, 3),
      ],
    });
    expect(
      codeOf(
        await as("u-luis", [
          ["member-juan", 2_000_000],
          ["member-pedro", 300_000],
        ]),
      ),
    ).toBe("ok");
    expect(plans.capacities.get(plan.id)).toEqual([
      { memberId: "member-juan", amount: 200_000_000n },
      { memberId: "member-pedro", amount: 30_000_000n },
    ]);
    expect(codeOf(await as("u-marta", [["member-juan", 1]]))).toBe("SpaceNotFound");
  });

  it("refuses a stale If-Match and changes nothing (Review Focus 1)", async () => {
    const { as, plans, plan } = await world();
    expect(codeOf(await as("u-ana", [["member-ana", 1_600_000]], 7))).toBe("PreconditionFailed");
    expect(plans.capacities.get(plan.id)).toBeUndefined();
    expect(codeOf(await as("u-ana", [["member-ana", 1_600_000]], 1))).toBe("ok");
  });

  it("refuses changes in an archived space (HU-E1-09)", async () => {
    const { as, spaces } = await world();
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await as("u-ana", [["member-ana", 1]]))).toBe("SpaceArchived");
  });
});

describe("SuggestCapacity (HU-E6-02, D17)", () => {
  it("suggests Ana her own 2026-10 income for the 2026-11 plan and saves nothing", async () => {
    const { deps, plan, plans } = await world();
    const income = fixedIncome({ "u-ana": 165_000_000n });
    const suggest = createSuggestCapacity({ ...deps, previousIncome: income.previousIncome });
    expect(unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id }))).toEqual({
      memberId: "member-ana",
      period: { label: "2026-10", start: "2026-10-01", end: "2026-10-31" },
      suggested: 165_000_000n,
      currency: "COP",
    });
    expect(income.asked).toEqual([{ userId: "u-ana", from: "2026-10-01", to: "2026-10-31" }]);
    expect(plans.capacities.get(plan.id)).toBeUndefined();
    expect(plans.plans[0]!.version).toBe(1);
  });

  it("answers Juan with his own suggestion only, never asking for Ana's income", async () => {
    const { deps, plan } = await world();
    const income = fixedIncome({ "u-ana": 165_000_000n, "u-juan": 240_000_000n });
    const suggest = createSuggestCapacity({ ...deps, previousIncome: income.previousIncome });
    const juan = unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-juan", planId: plan.id }));
    expect([juan.memberId, juan.suggested]).toEqual(["member-juan", 240_000_000n]);
    expect(income.asked.map((a) => a.userId)).toEqual(["u-juan"]);
  });

  it("answers Sofi the VIEWER, and answers in an archived space, since asking only reads", async () => {
    const { deps, plan, spaces } = await world();
    const income = fixedIncome({ "u-sofi": 90_000_000n });
    const suggest = createSuggestCapacity({ ...deps, previousIncome: income.previousIncome });
    spaces.archived.add(HOUSEHOLD);
    const sofi = unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-sofi", planId: plan.id }));
    expect([sofi.memberId, sofi.suggested]).toEqual(["member-sofi", 90_000_000n]);
  });

  it("suggests nothing when the personal space keeps another currency, and hides the plan from Marta", async () => {
    const { deps, plan } = await world();
    const dollars = createSuggestCapacity({
      ...deps,
      previousIncome: fixedIncome({ "u-ana": 500n }, "USD").previousIncome,
    });
    expect(
      unwrap(await dollars({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id })).suggested,
    ).toBeNull();
    expect(codeOf(await dollars({ spaceId: HOUSEHOLD, userId: "u-marta", planId: plan.id }))).toBe(
      "SpaceNotFound",
    );
  });

  it("suggests nothing when the user has no personal space, and knows no plan of another id", async () => {
    const { deps, plan } = await world();
    const suggest = createSuggestCapacity({ ...deps, previousIncome: async () => null });
    expect(
      unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id })).suggested,
    ).toBeNull();
    expect(codeOf(await suggest({ spaceId: HOUSEHOLD, userId: "u-ana", planId: "budget-404" }))).toBe(
      "BudgetPlanNotFound",
    );
  });

  it("looks at the previous period of the policy: 2026-11 H1 for a 2026-11 H2 plan", async () => {
    const w = budgetingWorld({ periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    const create = createCreateBudgetPlan(w.deps);
    const h2 = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11 H2" })).plan;
    const income = fixedIncome({});
    const suggest = createSuggestCapacity({ ...w.deps, previousIncome: income.previousIncome });
    unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-ana", planId: h2.id }));
    expect(income.asked).toEqual([{ userId: "u-ana", from: "2026-11-01", to: "2026-11-15" }]);
  });

  it("takes the stored plan's boundaries over the policy's once the policy changed (D10, spec 5.3)", async () => {
    const { deps, spaces } = await world();
    await spaces.updateSettings(HOUSEHOLD as SpaceId, {
      name: "Household",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 25 },
    });
    const december = unwrap(
      await createCreateBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-12" }),
    ).plan;
    const income = fixedIncome({});
    const suggest = createSuggestCapacity({ ...deps, previousIncome: income.previousIncome });
    const suggestion = unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-ana", planId: december.id }));
    expect(suggestion.period).toEqual({ label: "2026-11", start: "2026-11-01", end: "2026-11-30" });
    expect(income.asked).toEqual([{ userId: "u-ana", from: "2026-11-01", to: "2026-11-30" }]);
  });
});
