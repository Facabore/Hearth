import { describe, expect, it, vi } from "vitest";
import { authorizeSpaceAction } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
import { aLine } from "../../../../tests/support/budget-fixtures";
import {
  BUDGET_MEMBERS,
  budgetingWorld,
  HOUSEHOLD,
  householdCategories,
} from "../../../../tests/support/budgeting-world";
import { money, unwrap } from "../../../../tests/support/fakes";
import type { BudgetLineId, RolloverMode } from "../domain/budget-line";
import { createCopyBudgetPlan } from "./copy-budget-plan";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createGetBudgetPlan } from "./get-budget-plan";
import { loadPlanView, planViewCache, type BudgetPlanView } from "./plan-view";
import type { PlanSpending } from "./ports";
import { createRemoveBudgetLine } from "./remove-budget-line";
import { createUpdateBudgetLine } from "./update-budget-line";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");
const pesos = (n: number) => BigInt(n) * 100n;

/** Groceries spending by the first day of each plan's period, as the ledger sums it; records each period asked. */
class SpendingByPeriod implements PlanSpending {
  readonly asked: LocalDate[] = [];
  constructor(private readonly groceriesFrom: Readonly<Record<string, bigint>>) {}

  async expensesByCategory(_spaceId: string, from: LocalDate) {
    this.asked.push(from);
    const amount = this.groceriesFrom[from];
    return amount === undefined ? [] : [{ categoryId: "cat-groceries", amount }];
  }

  async transfersIntoAccounts() {
    return [];
  }
}

/**
 * HU-E6-09 Background: Home planned 1,470,000 COP with `mode` in Household's 2026-11 plan, Groceries mapped to it,
 * and the ledger's Groceries spending per period start; later plans are copies made with CopyBudgetPlan.
 */
const world = async (mode: RolloverMode, groceriesFrom: Readonly<Record<string, bigint>>) => {
  const w = budgetingWorld({ members: ANA_AND_JUAN });
  const spending = new SpendingByPeriod(groceriesFrom);
  const deps = {
    ...w.deps,
    spending,
    capacities: w.plans,
    lines: w.plans,
    mappings: w.plans,
    allocations: w.plans,
    categories: householdCategories,
  };
  const create = createCreateBudgetPlan(deps);
  const november = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(november.id, {
    capacities: [{ memberId: "member-ana", amount: 400_000_000n }],
    lines: [aLine("Home", 147_000_000n, { rolloverMode: mode })],
    mappings: [{ lineId: "line-home", categoryId: "cat-groceries" }],
  });
  const copyInto = async (period: string) =>
    unwrap(await createCopyBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period })).view;
  const read = async (planId: string) =>
    unwrap(await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", planId }));
  const write = (planId: string, lineId: string) => ({
    spaceId: HOUSEHOLD,
    userId: "u-ana",
    planId,
    lineId,
    expectedVersion: null,
  });
  // The in-memory repository's own status write, as `plan-lifecycle` leaves a closed plan (ruling P243 of M6c).
  const close = (planId: string) => w.plans.setStatus(planId, "CLOSED");
  return { ...w, deps, spending, november, copyInto, read, write, close };
};
const home = (view: BudgetPlanView) => {
  const [line] = view.figures.lines;
  return [line!.line.name, line!.carryOver, line!.available];
};

describe("carry-over along the chain of copies (HU-E6-09)", () => {
  it("carries Home's 200,000 COP left in 2026-11 into its 2026-12 copy with ROLLOVER, reading November for it", async () => {
    const { copyInto, read, november, spending, close } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
    });
    await close(november.id);
    spending.asked.length = 0;
    const december = await copyInto("2026-12");
    expect(spending.asked).toEqual(["2026-12-01", "2026-11-01"]);
    expect(home(await read(november.id))).toEqual(["Home", 0n, pesos(200_000)]);
    expect(home(december)).toEqual(["Home", pesos(200_000), pesos(1_670_000)]);
  });

  it("reads the space's categories once for the whole chain it walks, not once per plan (HU-E3-04)", async () => {
    const { copyInto, deps, november, close } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    await close(november.id);
    const december = await copyInto("2026-12");
    await close(december.plan.id);
    const january = await copyInto("2027-01");
    const asked: string[] = [];
    const categories = {
      list: async (spaceId: string) => {
        asked.push(spaceId);
        return householdCategories.list(spaceId);
      },
    };
    const read = createGetBudgetPlan({ ...deps, categories });
    unwrap(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId: january.plan.id }));
    expect(asked).toEqual([HOUSEHOLD]);
  });

  it("reads no earlier plan when no line carries over", async () => {
    const { copyInto, spending } = await world("RESET", { "2026-11-01": pesos(1_270_000) });
    spending.asked.length = 0;
    expect(home(await copyInto("2026-12"))).toEqual(["Home", 0n, pesos(1_470_000)]);
    expect(spending.asked).toEqual(["2026-12-01"]);
  });

  it("carries an ADJUSTED overspend along the chain: 2026-11 into 2026-12 into 2027-01 (Review Focus 4)", async () => {
    const { copyInto, november, close } = await world("ADJUSTED", {
      "2026-11-01": pesos(1_600_000),
      "2026-12-01": pesos(1_500_000),
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    expect(home(december)).toEqual(["Home", pesos(-130_000), pesos(-160_000)]);
    await close(december.plan.id);
    expect(home(await copyInto("2027-01"))).toEqual(["Home", pesos(-160_000), pesos(1_310_000)]);
  });

  it("carries a ROLLOVER leftover forward and floors an overspend at 0, so the next period carries 0 (Review Focus 4)", async () => {
    const { copyInto, read, november, spending, close } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
      "2026-12-01": pesos(1_800_000),
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    await close(december.plan.id);
    spending.asked.length = 0;
    const january = await copyInto("2027-01");
    // The chain is followed all the way back, though the floor hides what December carried in.
    expect(spending.asked).toEqual(["2027-01-01", "2026-12-01", "2026-11-01"]);
    expect(home(await read(november.id))).toEqual(["Home", 0n, pesos(200_000)]);
    expect(home(await read(december.plan.id))).toEqual(["Home", pesos(200_000), pesos(-130_000)]);
    expect(home(january)).toEqual(["Home", 0n, pesos(1_470_000)]);
  });

  it("follows the copied line after a rename: House still receives Home's 200,000 COP", async () => {
    const { copyInto, deps, read, write, november, close } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    const [copied] = december.figures.lines;
    unwrap(
      await createUpdateBudgetLine(deps)({
        ...write(december.plan.id, copied!.line.id),
        changes: { name: "House" },
      }),
    );
    expect(home(await read(december.plan.id))).toEqual(["House", pesos(200_000), pesos(1_670_000)]);
  });

  it("carries 0 once the origin line was removed from the earlier plan (Review Focus 5)", async () => {
    const { copyInto, deps, read, write, november, close } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
    });
    const december = await copyInto("2026-12");
    unwrap(await createRemoveBudgetLine(deps)(write(november.id, "line-home")));
    await close(november.id);
    expect(home(await read(december.plan.id))).toEqual(["Home", 0n, pesos(1_470_000)]);
  });

  it.each([
    ["DRAFT", 0n, false],
    ["ACTIVE", 0n, false],
    ["CLOSED", pesos(200_000), true],
  ] as const)(
    "a DRAFT copy of a %s earlier plan carries %s: only a CLOSED source carries (ruling P243 of M6c, amending P15)",
    async (status, carried, closed) => {
      const { copyInto, plans, november } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
      await plans.setStatus(november.id, status);
      const december = await copyInto("2026-12");
      expect(december.plan.status).toBe("DRAFT");
      expect(home(december)).toEqual(["Home", carried, pesos(1_470_000) + carried]);
      expect(december.figures.lines[0]!.carryOverFrom).toEqual({
        planId: november.id,
        period: november.period,
        closed,
      });
    },
  );

  it("carries nothing into a plan that was not copied: no previous plan means no carry-over", async () => {
    const { read, november, spending } = await world("ROLLOVER", {});
    spending.asked.length = 0;
    expect(home(await read(november.id))).toEqual(["Home", 0n, pesos(1_470_000)]);
    expect(spending.asked).toEqual(["2026-11-01"]);
  });

  it("takes no lock to read the earlier plans: a write to the copy locks the copy alone and answers its carry-over", async () => {
    const { copyInto, deps, plans, write, november, close } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    const [copied] = december.figures.lines;
    const lock = vi.spyOn(plans, "lockForWrite");
    const covering = vi.spyOn(plans, "covering");
    const answer = unwrap(
      await createUpdateBudgetLine(deps)({
        ...write(december.plan.id, copied!.line.id),
        changes: { name: "House" },
      }),
    );
    expect(home(answer)).toEqual(["House", pesos(200_000), pesos(1_670_000)]);
    expect(lock.mock.calls.map(([planId]) => planId)).toEqual([december.plan.id]);
    expect(covering).not.toHaveBeenCalled();
  });

  it("ends on a malformed chain whose createdFrom loops back: the plan already seen is not read again", async () => {
    const { copyInto, plans, read, november, close } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    const [copied] = december.figures.lines;
    // No use case can do this (a copy always names an earlier plan), so the stored rows are changed directly:
    // November is made a copy of December, with its line copied from December's, so each carries over from the other.
    plans.plans = plans.plans.map((p) =>
      p.id === november.id ? { ...p, createdFrom: december.plan.id } : p,
    );
    plans.lines = plans.lines.map((r) =>
      r.line.planId === november.id ? { ...r, line: { ...r.line, originLineId: copied!.line.id } } : r,
    );
    const found = plans.find.bind(plans);
    let reads = 0;
    vi.spyOn(plans, "find").mockImplementation(async (spaceId, planId) => {
      if (++reads > 10) throw new Error("the createdFrom chain did not end");
      return found(spaceId, planId);
    });
    // November reads December's available only through the seen guard: it carries 0 back, so December keeps 200,000.
    expect(home(await read(december.plan.id))).toEqual(["Home", pesos(200_000), pesos(1_670_000)]);
    expect(reads).toBeLessThanOrEqual(3);
  });

  it("carries nothing from a plan that is not CLOSED yet, and says which plan it waits for (#143, ruling P243 of M6c)", async () => {
    const { copyInto, november } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    const december = await copyInto("2026-12");
    const [line] = december.figures.lines;
    expect(home(december)).toEqual(["Home", 0n, pesos(1_470_000)]);
    expect(line!.carryOverFrom).toEqual({ planId: november.id, period: november.period, closed: false });
  });

  it("carries once the source is CLOSED and names it, and a line the source never had carries nothing", async () => {
    const { copyInto, november, close, read, plans } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    expect(home(december)).toEqual(["Home", pesos(200_000), pesos(1_670_000)]);
    expect(december.figures.lines[0]!.carryOverFrom).toEqual({
      planId: november.id,
      period: november.period,
      closed: true,
    });
    // A line added to December has no origin: no history, so no carry and no source (the competitor's pitfall).
    plans.seed(december.plan.id, {
      lines: [aLine("Pets", pesos(100_000), { id: "line-pets" as BudgetLineId, rolloverMode: "ROLLOVER" })],
    });
    const pets = (await read(december.plan.id)).figures.lines.find((f) => f.line.name === "Pets")!;
    expect([pets.carryOver, pets.carryOverFrom]).toEqual([0n, null]);
  });

  it("turning ROLLOVER on carries nothing while the line's origin plan is open, and names the plan it waits for (ruling P243)", async () => {
    const { copyInto, deps, november, close, read, write } = await world("RESET", {
      "2026-11-01": pesos(1_270_000),
    });
    const december = await copyInto("2026-12");
    const [copied] = december.figures.lines;
    unwrap(
      await createUpdateBudgetLine(deps)({
        ...write(december.plan.id, copied!.line.id),
        changes: { rolloverMode: "ROLLOVER" },
      }),
    );
    const waiting = (await read(december.plan.id)).figures.lines[0]!;
    expect([waiting.carryOver, waiting.carryOverFrom]).toEqual([
      0n,
      { planId: november.id, period: november.period, closed: false },
    ]);
    // It carries from the origin line's own plan only once that plan is CLOSED.
    await close(november.id);
    const closed = (await read(december.plan.id)).figures.lines[0]!;
    expect([closed.carryOver, closed.carryOverFrom?.closed]).toEqual([pesos(200_000), true]);
  });

  it("names no source for a RESET line, even from a CLOSED plan", async () => {
    const { copyInto, november, close } = await world("RESET", { "2026-11-01": pesos(1_270_000) });
    await close(november.id);
    expect((await copyInto("2026-12")).figures.lines[0]!.carryOverFrom).toBeNull();
  });

  it("names a source only on the lines that carry: a RESET line beside a ROLLOVER one has none (ruling P243)", async () => {
    const { copyInto, november, plans, close } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    plans.seed(november.id, {
      lines: [aLine("Rent", pesos(500_000), { id: "line-rent" as BudgetLineId, rolloverMode: "RESET" })],
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    expect(december.figures.lines.map((f) => [f.line.name, f.carryOverFrom?.planId ?? null])).toEqual([
      ["Home", november.id],
      ["Rent", null],
    ]);
  });

  it("walks a chain only through CLOSED plans: a closed December whose November is still open carries 0, and January carries December's whole available (ruling P243)", async () => {
    const { copyInto, read, november, close } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    const december = await copyInto("2026-12");
    await close(december.plan.id);
    const january = await copyInto("2027-01");
    expect(home(await read(december.plan.id))).toEqual(["Home", 0n, pesos(1_470_000)]);
    expect((await read(december.plan.id)).figures.lines[0]!.carryOverFrom).toEqual({
      planId: november.id,
      period: november.period,
      closed: false,
    });
    expect(home(january)).toEqual(["Home", pesos(1_470_000), pesos(2_940_000)]);
    expect(january.figures.lines[0]!.carryOverFrom).toMatchObject({ planId: december.plan.id, closed: true });
  });

  it("never counts a carry-over against the capacity: Home plans all 4,000,000 COP while it carries 200,000 (#143, ruling P229 of M6c)", async () => {
    const { copyInto, deps, read, write, close, november } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    const [copied] = december.figures.lines;
    unwrap(
      await createUpdateBudgetLine(deps)({
        ...write(december.plan.id, copied!.line.id),
        changes: { plannedAmount: money(pesos(4_000_000)) },
      }),
    );
    const view = await read(december.plan.id);
    expect(home(view)).toEqual(["Home", pesos(200_000), pesos(4_200_000)]);
    expect(view.figures.planned).toBe(pesos(4_000_000));
    expect(view.figures.unallocated).toBe(0n);
  });
});

describe("one request's plan figures, shared by plan id (ruling P105)", () => {
  const chainOfFour = async () => {
    const w = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
      "2026-12-01": pesos(1_800_000),
      "2027-01-01": pesos(1_000_000),
    });
    await w.close(w.november.id);
    const december = await w.copyInto("2026-12");
    await w.close(december.plan.id);
    const january = await w.copyInto("2027-01");
    await w.close(january.plan.id);
    const february = await w.copyInto("2027-02");
    const space = unwrap(await authorizeSpaceAction(w.deps.access, HOUSEHOLD, "u-ana", "space.read"));
    const plans = [w.november, december.plan, january.plan, february.plan];
    return { ...w, space, plans };
  };

  it("figures each plan of the chain once for every view that shares the cache, as each view figures it alone", async () => {
    const { deps, plans, space } = await chainOfFour();
    const alone = await Promise.all(plans.map((plan) => loadPlanView(deps, space, plan)));
    const contents = vi.spyOn(deps.plans, "contents");
    const members = vi.spyOn(deps.members, "listCurrent");
    const cache = planViewCache();
    const shared = await Promise.all(plans.map((plan) => loadPlanView(deps, space, plan, cache)));
    expect(shared).toEqual(alone);
    expect(contents.mock.calls.map(([planId]) => planId)).toEqual(plans.map((p) => p.id));
    expect(members).toHaveBeenCalledTimes(1);
  });

  it("ends on a malformed chain whose createdFrom loops back, even when both plans are viewed at once", async () => {
    const { copyInto, deps, plans, read, november, close } = await world("ROLLOVER", {
      "2026-11-01": pesos(1_270_000),
    });
    await close(november.id);
    const december = await copyInto("2026-12");
    const [copied] = december.figures.lines;
    // As in the seen-guard case above: November made a copy of December, its line copied from December's.
    plans.plans = plans.plans.map((p) =>
      p.id === november.id ? { ...p, createdFrom: december.plan.id } : p,
    );
    plans.lines = plans.lines.map((r) =>
      r.line.planId === november.id ? { ...r, line: { ...r.line, originLineId: copied!.line.id } } : r,
    );
    const space = unwrap(await authorizeSpaceAction(deps.access, HOUSEHOLD, "u-ana", "space.read"));
    const looped = await Promise.all([november.id, december.plan.id].map((id) => plans.find(HOUSEHOLD, id)));
    // Each read of a plan is slow, so both views have started figuring their plan before either reads its source.
    const found = plans.find.bind(plans);
    vi.spyOn(plans, "find").mockImplementation(async (spaceId, planId) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return found(spaceId, planId);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("the views waited on each other")), 1_000);
    });
    const cache = planViewCache();
    const both = Promise.all(looped.map((plan) => loadPlanView(deps, space, plan!, cache)));
    try {
      expect(await Promise.race([both, stalled])).toHaveLength(2);
    } finally {
      clearTimeout(timer);
    }
    // Viewed alone, the cache answers what the view without it answers.
    expect(await loadPlanView(deps, space, december.plan, planViewCache())).toEqual(
      await read(december.plan.id),
    );
  });
});
