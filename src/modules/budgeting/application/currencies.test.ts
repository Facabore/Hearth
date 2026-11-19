import { describe, expect, it } from "vitest";
import { budgetingWorld, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { createAddBudgetLine, type LineInput } from "./add-budget-line";
import { createAllocateBudgetLine } from "./allocate-budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createActivateBudgetPlan } from "./plan-lifecycle";
import { createSetMemberCapacities } from "./set-member-capacities";
import { createUpdateBudgetLine } from "./update-budget-line";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const usd = (dollars: number) => money(BigInt(dollars) * 100n, "USD");

/**
 * Ruling P342 (S7, "Líneas por moneda"), the approved planner board: Household (COP) plans December with Ana
 * 1.600.000 COP, Juan 2.400.000 COP and 100 USD; Salidas plans 300.000 COP and 100 USD.
 */
const world = async () => {
  const w = budgetingWorld();
  const deps = { ...w.deps, capacities: w.plans, lines: w.plans, allocations: w.plans, statuses: w.plans };
  const plan = unwrap(
    await createCreateBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-12" }),
  ).plan;
  const input = { spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, expectedVersion: null };
  const setCapacities = (capacities: { memberId: string; amount: ReturnType<typeof cop> }[]) =>
    createSetMemberCapacities(deps)({ ...input, capacities });
  unwrap(
    await setCapacities([
      { memberId: "member-ana", amount: cop(1_600_000) },
      { memberId: "member-juan", amount: cop(2_400_000) },
      { memberId: "member-juan", amount: usd(100) },
    ]),
  );
  const addLine = (line: LineInput) => createAddBudgetLine(deps)({ ...input, line });
  const update = createUpdateBudgetLine(deps);
  const allocate = createAllocateBudgetLine(deps);
  const activate = () => createActivateBudgetPlan(deps)(input);
  return { ...w, deps, plan, input, setCapacities, addLine, update, allocate, activate };
};

describe("budget lines per currency through the use cases (P342, S7)", () => {
  it("adds Salidas with 300.000 COP and 100 USD and reports Por repartir per currency", async () => {
    const { addLine } = await world();
    unwrap(await addLine({ name: "Arriendo", budgets: [cop(3_700_000)] }));
    const view = unwrap(await addLine({ name: "Salidas", budgets: [cop(300_000), usd(100)] }));
    const salidas = view.figures.lines.find((l) => l.line.name === "Salidas")!;
    expect(salidas.line.budgets).toEqual([
      { currency: "COP", amount: 30_000_000n },
      { currency: "USD", amount: 10_000n },
    ]);
    expect(view.figures.currencies.map((c) => [c.currency, c.unallocated])).toEqual([
      ["COP", 0n],
      ["USD", 0n],
    ]);
  });

  it("refuses a USD budget beyond the USD contributions, whatever is left in COP", async () => {
    const { addLine } = await world();
    expect(
      unwrap(await addLine({ name: "Salidas", budgets: [cop(300_000), usd(100)] })).figures.unallocated,
    ).toBe(370_000_000n);
    const more = await addLine({ name: "Viaje", budgets: [usd(1)] });
    expect(more).toEqual({ ok: false, error: { code: "PlanExceedsCapacity", details: { currency: "USD" } } });
  });

  it("replaces a line's budgets as a set, or one currency's with plannedAmount, keeping the others", async () => {
    const { addLine, update, input } = await world();
    const added = unwrap(await addLine({ name: "Salidas", budgets: [cop(300_000)] }));
    const lineId = added.figures.lines[0]!.line.id;
    const withUsd = unwrap(await update({ ...input, lineId, changes: { plannedAmount: usd(50) } }));
    expect(withUsd.figures.lines[0]!.line.budgets).toEqual([
      { currency: "COP", amount: 30_000_000n },
      { currency: "USD", amount: 5_000n },
    ]);
    const onlyUsd = unwrap(await update({ ...input, lineId, changes: { budgets: [usd(80)] } }));
    expect(onlyUsd.figures.lines[0]!.line.budgets).toEqual([{ currency: "USD", amount: 8_000n }]);
    // A line without a COP budget reports 0 COP planned in the space currency's scalar figures.
    expect(onlyUsd.figures.lines[0]!.planned).toBe(0n);
  });

  it("allocates FIXED per currency and activates only while every currency fits", async () => {
    const { addLine, allocate, activate, input, setCapacities } = await world();
    unwrap(await addLine({ name: "Arriendo", budgets: [cop(3_700_000)] }));
    const view = unwrap(await addLine({ name: "Salidas", budgets: [cop(300_000), usd(100)] }));
    const lineId = view.figures.lines.find((l) => l.line.name === "Salidas")!.line.id;
    const fixed = unwrap(
      await allocate({
        ...input,
        lineId,
        allocation: {
          rule: "FIXED",
          members: [
            { memberId: "member-ana", amount: cop(100_000) },
            { memberId: "member-juan", amount: cop(200_000) },
            { memberId: "member-juan", amount: usd(100) },
          ],
        },
      }),
    );
    const salidas = fixed.figures.lines.find((l) => l.line.id === lineId)!;
    expect(salidas.budgets.map((b) => [b.currency, b.allocation.members.map((m) => m.assigned)])).toEqual([
      ["COP", [10_000_000n, 20_000_000n, 0n, 0n]],
      ["USD", [0n, 10_000n, 0n, 0n]],
    ]);
    // Juan lowers his USD to 99: COP still fits, USD does not.
    unwrap(await setCapacities([{ memberId: "member-juan", amount: usd(99) }]));
    expect(await activate()).toEqual({
      ok: false,
      error: { code: "PlanExceedsCapacity", details: { currency: "USD" } },
    });
    unwrap(await setCapacities([{ memberId: "member-juan", amount: usd(100) }]));
    expect(codeOf(await activate())).toBe("ok");
  });
});
