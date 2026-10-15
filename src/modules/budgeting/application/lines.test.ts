import { describe, expect, it } from "vitest";
import { aLine } from "../../../../tests/support/budget-fixtures";
import {
  BUDGET_MEMBERS,
  budgetingWorld,
  HOUSEHOLD,
  savingsAccounts,
} from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { createAddBudgetLine, type LineInput } from "./add-budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { lineOf, usableSavingsAccounts } from "./line-checks";
import { createSetMemberCapacities } from "./set-member-capacities";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const RENT: LineInput = {
  name: "Rent",
  plannedAmount: cop(1_200_000),
  funding: "SHARED_FUND",
  rolloverMode: "RESET",
};
const HOME: LineInput = {
  name: "Home",
  plannedAmount: cop(1_470_000),
  funding: "DIRECT",
  rolloverMode: "RESET",
};
const SAVINGS: LineInput = {
  name: "Savings",
  plannedAmount: cop(600_000),
  funding: "SAVINGS",
  savingsAccountIds: ["acc-savings"],
};
const FREE: LineInput = { name: "Free", plannedAmount: cop(730_000) };

/** HU-E6-03 Background: a DRAFT plan for 2026-11 with capacities Ana 1,600,000 COP and Juan 2,400,000 COP. */
const world = async () => {
  const w = budgetingWorld();
  const deps = { ...w.deps, capacities: w.plans, lines: w.plans, savingsAccounts };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  const capacities = [
    { memberId: "member-ana", amount: cop(1_600_000) },
    { memberId: "member-juan", amount: cop(2_400_000) },
  ];
  const set = createSetMemberCapacities(deps);
  unwrap(
    await set({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, expectedVersion: null, capacities }),
  );
  const add = createAddBudgetLine(deps);
  const addLine = (line: LineInput, userId = "u-ana", expectedVersion: number | null = null) =>
    add({ spaceId: HOUSEHOLD, userId, planId: plan.id, expectedVersion, line });
  return { ...w, deps, plan, add, addLine };
};

describe("AddBudgetLine (HU-E6-03)", () => {
  it("reports 1,330,000 COP unallocated after Rent and Home, with Home at 36.75 % (golden)", async () => {
    const { addLine } = await world();
    unwrap(await addLine(RENT));
    const view = unwrap(await addLine(HOME));
    expect(view.figures.unallocated).toBe(133_000_000n);
    const home = view.figures.lines.find((l) => l.line.name === "Home")!;
    expect([
      home.capacityShareBasisPoints,
      home.line.funding,
      home.line.rolloverMode,
      home.allocation.rule,
    ]).toEqual([3675, "DIRECT", "RESET", "PROPORTIONAL"]);
    expect(view.plan.version).toBe(4);
  });

  it("leaves nothing unallocated with the full reference plan, and refuses Travel past it (golden)", async () => {
    const { addLine } = await world();
    for (const line of [RENT, HOME, SAVINGS]) unwrap(await addLine(line));
    expect(unwrap(await addLine(FREE)).figures.unallocated).toBe(0n);
    expect(codeOf(await addLine({ name: "Travel", plannedAmount: cop(100_000) }))).toBe(
      "PlanExceedsCapacity",
    );
  });

  it("funds a line DIRECT and resets its rollover when it names neither (assumption 5)", async () => {
    const { addLine } = await world();
    const view = unwrap(await addLine(FREE));
    const [free] = view.figures.lines;
    expect([
      free!.line.funding,
      free!.line.rolloverMode,
      free!.line.isCatchAll,
      free!.line.savingsAccountIds,
    ]).toEqual(["DIRECT", "RESET", false, []]);
  });

  it("keeps names unique within the plan ignoring case, and planned amounts positive in the space currency", async () => {
    const { addLine } = await world();
    unwrap(await addLine(HOME));
    expect(codeOf(await addLine({ ...HOME, name: "home" }))).toBe("BudgetLineNameTaken");
    expect(codeOf(await addLine({ name: "Gifts", plannedAmount: cop(0) }))).toBe("InvalidPlannedAmount");
    expect(codeOf(await addLine({ name: "Gifts", plannedAmount: money(100n, "USD") }))).toBe(
      "CurrencyMismatch",
    );
  });

  it("counts only the capacity of the current members (P7)", async () => {
    const { addLine, plans, plan } = await world();
    // Luis left the space but his row stays (D8): his 1,000,000 COP must not make room for the line.
    plans.seed(plan.id, { capacities: [{ memberId: "member-luis", amount: cop(1_000_000).minor }] });
    expect(codeOf(await addLine({ name: "Big", plannedAmount: cop(4_000_001) }))).toBe("PlanExceedsCapacity");
    expect(codeOf(await addLine({ name: "Big", plannedAmount: cop(4_000_000) }))).toBe("ok");
  });

  it("requires a savings account of a current member on a SAVINGS line (Review Focus 5)", async () => {
    const { addLine } = await world();
    const savingsWith = (savingsAccountIds: string[]) => addLine({ ...SAVINGS, savingsAccountIds });
    expect(codeOf(await savingsWith([]))).toBe("SavingsAccountRequired");
    expect(codeOf(await savingsWith(["acc-bank"]))).toBe("InvalidSavingsAccount");
    expect(codeOf(await savingsWith(["acc-old-savings"]))).toBe("AccountArchived");
    expect(codeOf(await savingsWith(["acc-marta-savings"]))).toBe("AccountNotFound");
    expect(codeOf(await savingsWith(["acc-unknown"]))).toBe("AccountNotFound");
    const view = unwrap(await savingsWith(["acc-savings", "acc-juan-savings"]));
    expect(view.figures.lines[0]!.line.savingsAccountIds).toEqual(["acc-savings", "acc-juan-savings"]);
  });

  it("lets one savings account back one SAVINGS line of the plan", async () => {
    const { addLine } = await world();
    unwrap(await addLine(SAVINGS));
    expect(codeOf(await addLine({ ...SAVINGS, name: "More savings" }))).toBe("SavingsAccountAlreadyUsed");
    expect(codeOf(await addLine({ ...SAVINGS, name: "Juan", savingsAccountIds: ["acc-juan-savings"] }))).toBe(
      "ok",
    );
  });

  it("adds the catch-all line once (HU-E6-04)", async () => {
    const { addLine } = await world();
    unwrap(await addLine({ ...FREE, isCatchAll: true }));
    expect(codeOf(await addLine({ ...HOME, isCatchAll: true }))).toBe("CatchAllLineAlreadySet");
    expect(codeOf(await addLine({ ...SAVINGS, isCatchAll: true }))).toBe("SavingsLineNotMappable");
  });

  it("lets only owners and admins add lines, and refuses a stale If-Match", async () => {
    const { addLine } = await world();
    expect(codeOf(await addLine(HOME, "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await addLine(HOME, "u-ana", 1))).toBe("PreconditionFailed");
    expect(codeOf(await addLine(HOME, "u-ana", 2))).toBe("ok");
  });

  it("answers SpaceNotFound to a stranger, SpaceArchived in an archived space and BudgetPlanNotFound for any other plan", async () => {
    const { add, addLine, spaces, plan } = await world();
    const asMarta = await add({
      spaceId: HOUSEHOLD,
      userId: "u-marta",
      planId: plan.id,
      expectedVersion: null,
      line: HOME,
    });
    expect(codeOf(asMarta)).toBe("SpaceNotFound");
    for (const planId of ["budget-404", "not-a-uuid", ""]) {
      const unknown = await add({
        spaceId: HOUSEHOLD,
        userId: "u-ana",
        planId,
        expectedVersion: null,
        line: HOME,
      });
      expect(codeOf(unknown)).toBe("BudgetPlanNotFound");
    }
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await addLine(HOME))).toBe("SpaceArchived");
  });
});

describe("line checks (HU-E6-03)", () => {
  const parts = {
    capacities: [],
    mappings: [],
    allocations: [],
    lines: [aLine("Home", 100n), aLine("Rent", 200n)],
  };

  it("finds only the current lines of the plan, whatever the id looks like", () => {
    expect(unwrap(lineOf(parts, "line-home")).name).toBe("Home");
    for (const id of ["line-gone", "", "not-a-uuid", "' OR 1=1 --"]) {
      expect(codeOf(lineOf(parts, id))).toBe("BudgetLineNotFound");
    }
  });

  it("checks the accounts a line newly names, and skips those it already named (Task 12b)", async () => {
    const check = (ids: string[], already: string[] = []) =>
      usableSavingsAccounts(savingsAccounts, BUDGET_MEMBERS, ids, already);
    expect(codeOf(await check(["acc-old-savings"]))).toBe("AccountArchived");
    expect(codeOf(await check(["acc-old-savings"], ["acc-old-savings"]))).toBe("ok");
    expect(codeOf(await check(["acc-savings", "acc-old-savings"], ["acc-old-savings"]))).toBe("ok");
    expect(codeOf(await check(["acc-marta-savings"], ["acc-savings"]))).toBe("AccountNotFound");
  });

  it("answers AccountNotFound for an account without an owner and for one that does not exist", async () => {
    const accounts = {
      find: async (id: string) =>
        id === "acc-orphan" ? { id, ownerUserId: null, isSavings: true, archived: false } : null,
    };
    const check = (ids: string[]) => usableSavingsAccounts(accounts, BUDGET_MEMBERS, ids);
    expect(codeOf(await check(["acc-orphan"]))).toBe("AccountNotFound");
    expect(codeOf(await check(["acc-nothing"]))).toBe("AccountNotFound");
  });
});
