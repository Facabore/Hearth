import { describe, expect, it, vi } from "vitest";
import { requirePermission, type SpaceId } from "@/modules/spaces/application";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { budgetingWorld, HOUSEHOLD, NOW, savingsAccounts } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createGetBudgetPlan } from "./get-budget-plan";
import { planForWrite } from "./plan-access";
import type { BudgetAccount, SavingsAccountReader } from "./ports";

const as = (userId: string, period = "2026-11", spaceId = HOUSEHOLD) => ({ spaceId, userId, period });

describe("CreateBudgetPlan (HU-E6-01)", () => {
  it("creates a DRAFT plan for 2026-11 from 2026-11-01 to 2026-11-30, every current member at 0 COP", async () => {
    const { deps } = budgetingWorld();
    const view = unwrap(await createCreateBudgetPlan(deps)(as("u-ana")));
    expect(view.plan).toEqual({
      id: "budget-1",
      spaceId: HOUSEHOLD,
      period: { label: "2026-11", start: "2026-11-01", end: "2026-11-30" },
      status: "DRAFT",
      createdFrom: null,
      version: 1,
      createdBy: "u-ana",
      createdAt: NOW,
    });
    expect(view.figures.capacities.map((c) => [c.memberId, c.amount])).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
      ["member-sofi", 0n],
      ["member-pedro", 0n],
    ]);
    expect([view.currency, view.figures.lines, view.figures.unbudgeted]).toEqual([
      "COP",
      [],
      { spent: 0n, available: 0n },
    ]);
  });

  it("allows only one plan per period", async () => {
    const { deps } = budgetingWorld();
    const create = createCreateBudgetPlan(deps);
    unwrap(await create(as("u-ana")));
    expect(codeOf(await create(as("u-ana")))).toBe("PlanAlreadyExists");
  });

  it("answers PlanAlreadyExists when the unique index decides a concurrent creation of the period", async () => {
    const { deps, plans } = budgetingWorld();
    // Another request stored the period between the stored-periods read and the insert: the index stores nothing.
    plans.add = async () => false;
    expect(codeOf(await createCreateBudgetPlan(deps)(as("u-ana")))).toBe("PlanAlreadyExists");
  });

  it("lets the OWNER create plans, not Juan the MEMBER or Sofi the VIEWER, and hides the space from Marta", async () => {
    const { deps, plans } = budgetingWorld();
    const create = createCreateBudgetPlan(deps);
    expect(codeOf(await create(as("u-juan", "2026-12")))).toBe("InsufficientRole");
    expect(codeOf(await create(as("u-sofi", "2026-12")))).toBe("InsufficientRole");
    expect(codeOf(await create(as("u-marta")))).toBe("SpaceNotFound");
    expect(plans.plans).toEqual([]);
  });

  it("gives Ana's personal space a plan with Ana as its only member", async () => {
    const { deps } = budgetingWorld();
    const view = unwrap(await createCreateBudgetPlan(deps)(as("u-ana", "2026-11", "space-ana")));
    expect(view.plan.status).toBe("DRAFT");
    expect(view.figures.capacities.map((c) => c.memberId)).toEqual(["member-ana-personal"]);
  });

  it("gives a semi-monthly space two plans per month, each with its own capacities", async () => {
    const { deps, plans } = budgetingWorld({ periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    const create = createCreateBudgetPlan(deps);
    const h1 = unwrap(await create(as("u-ana", "2026-11 H1"))).plan;
    const h2 = unwrap(await create(as("u-ana", "2026-11 H2"))).plan;
    expect([h1.period, h2.period]).toEqual([
      { label: "2026-11 H1", start: "2026-11-01", end: "2026-11-15" },
      { label: "2026-11 H2", start: "2026-11-16", end: "2026-11-30" },
    ]);
    plans.seed(h1.id, { capacities: [{ memberId: "member-ana", amount: 80_000_000n }] });
    const read = createGetBudgetPlan(deps);
    const total = async (planId: string) =>
      unwrap(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId })).figures.totalCapacity;
    expect([await total(h1.id), await total(h2.id)]).toEqual([80_000_000n, 0n]);
  });

  it("starts a plan the day after a stored plan once the policy changed (D10, Review Focus 4)", async () => {
    const { deps, spaces } = budgetingWorld();
    const create = createCreateBudgetPlan(deps);
    unwrap(await create(as("u-ana", "2026-11")));
    await spaces.updateSettings(HOUSEHOLD as SpaceId, {
      name: "Household",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 25 },
    });
    const december = unwrap(await create(as("u-ana", "2026-12"))).plan;
    expect(december.period).toEqual({ label: "2026-12", start: "2026-12-01", end: "2026-12-24" });
    expect(codeOf(await create(as("u-ana", "2026-11")))).toBe("PlanAlreadyExists");
  });

  it("refuses labels that name no period of the policy", async () => {
    const { deps } = budgetingWorld();
    const create = createCreateBudgetPlan(deps);
    for (const period of ["2026-13", "November", "2026-11 H1"]) {
      expect(codeOf(await create(as("u-ana", period)))).toBe("InvalidPeriodLabel");
    }
  });

  it("refuses to create plans in an archived space (HU-E1-09)", async () => {
    const { deps, spaces } = budgetingWorld();
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await createCreateBudgetPlan(deps)(as("u-ana")))).toBe("SpaceArchived");
  });
});

describe("GetBudgetPlan (HU-E6-01)", () => {
  it("shows any member, Sofi the VIEWER included, the figures of the plan's own period", async () => {
    const { deps, plans, spending } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    plans.seed(plan.id, {
      capacities: [
        { memberId: "member-ana", amount: 160_000_000n },
        { memberId: "member-juan", amount: 240_000_000n },
      ],
      lines: referenceLines(),
    });
    spending.byCategory = [{ categoryId: "cat-entertainment", amount: 25_000_000n }];
    const view = unwrap(
      await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-sofi", planId: plan.id }),
    );
    expect([view.figures.totalCapacity, view.figures.unallocated]).toEqual([400_000_000n, 0n]);
    expect(view.figures.lines.find((l) => l.line.name === "Free")!.spent).toBe(25_000_000n);
    expect(spending.asked.at(-1)).toEqual({ spaceId: HOUSEHOLD, from: "2026-11-01", to: "2026-11-30" });
  });

  it("counts the transfers into a SAVINGS line's accounts, and asks for them only when a line names accounts", async () => {
    const { deps, plans, spending } = budgetingWorld();
    const transfers = vi.spyOn(spending, "transfersIntoAccounts");
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    const read = createGetBudgetPlan(deps);
    unwrap(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id }));
    expect(transfers).not.toHaveBeenCalled();
    plans.seed(plan.id, { lines: referenceLines() });
    spending.byAccount = [
      { accountId: "acc-savings", amount: 60_000_000n },
      { accountId: "acc-other", amount: 5_000_000n },
    ];
    const view = unwrap(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id }));
    expect(transfers).toHaveBeenCalledWith(["acc-savings"], "2026-11-01", "2026-11-30");
    expect(view.figures.lines.find((l) => l.line.name === "Savings")!.spent).toBe(60_000_000n);
  });

  it("counts the transfers into an account only while its owner is a current registered member, whoever reads (P8)", async () => {
    const { deps, plans, spending, spaces } = budgetingWorld();
    const transfers = vi.spyOn(spending, "transfersIntoAccounts");
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    await spaces.addMember(HOUSEHOLD, memberOf("Luis", "ADMIN", 4));
    // Marta never belonged to the space: only data written outside the use cases can name her account.
    const accounts = ["acc-savings", "acc-luis-savings", "acc-marta-savings"];
    plans.seed(plan.id, {
      lines: [aLine("Savings", 60_000_000n, { funding: "SAVINGS", savingsAccountIds: accounts })],
    });
    spending.byAccount = [
      { accountId: "acc-savings", amount: 10_000_000n },
      { accountId: "acc-luis-savings", amount: 5_000_000n },
      { accountId: "acc-marta-savings", amount: 2_000_000n },
    ];
    const spentAs = async (userId: string) =>
      unwrap(await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId, planId: plan.id })).figures
        .lines[0]!.spent;
    expect(await spentAs("u-ana")).toBe(15_000_000n);
    expect(transfers).toHaveBeenLastCalledWith(
      ["acc-savings", "acc-luis-savings"],
      "2026-11-01",
      "2026-11-30",
    );

    expect(await spaces.markLeft(HOUSEHOLD, "member-luis", "USER", NOW)).toBe(true);
    // Sofi the VIEWER and Ana read the same figure, with nothing from the account of the owner who left.
    expect(await spentAs("u-sofi")).toBe(10_000_000n);
    expect(await spentAs("u-ana")).toBe(10_000_000n);
    expect(transfers).toHaveBeenLastCalledWith(["acc-savings"], "2026-11-01", "2026-11-30");

    // The filter runs on every read, over the whole period: Luis rejoins and his transfers count again.
    expect(await spaces.addMember(HOUSEHOLD, memberOf("Luis", "MEMBER", 5))).toBe("added");
    expect(await spentAs("u-sofi")).toBe(15_000_000n);
  });

  it("asks for every named account before waiting for any, and keeps the lines' order whichever answers first", async () => {
    const { deps, plans, spending } = budgetingWorld();
    const transfers = vi.spyOn(spending, "transfersIntoAccounts");
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    const named = ["acc-savings", "acc-reserve"];
    plans.seed(plan.id, {
      lines: [aLine("Savings", 60_000_000n, { funding: "SAVINGS", savingsAccountIds: named })],
    });
    // Each lookup stays pending until the test answers it.
    const pending = new Map<string, (account: BudgetAccount | null) => void>();
    const slow: SavingsAccountReader = {
      find: (id) => new Promise((resolve) => pending.set(id, resolve)),
    };
    const read = createGetBudgetPlan({ ...deps, savingsAccounts: slow })({
      spaceId: HOUSEHOLD,
      userId: "u-ana",
      planId: plan.id,
    });
    await vi.waitFor(() => expect([...pending.keys()]).toEqual(named));
    // The second answers first.
    pending.get("acc-reserve")!(await savingsAccounts.find("acc-reserve"));
    pending.get("acc-savings")!(await savingsAccounts.find("acc-savings"));
    unwrap(await read);
    expect(transfers).toHaveBeenCalledWith(named, "2026-11-01", "2026-11-30");
  });

  it("derives the figures from the current lines, mappings, allocations and members only (D8, D15)", async () => {
    const { deps, plans, spending, spaces } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    const [rent, home, savings, free] = referenceLines();
    plans.seed(plan.id, {
      capacities: [
        { memberId: "member-ana", amount: 160_000_000n },
        { memberId: "member-pedro", amount: 40_000_000n },
      ],
      lines: [rent!, home!, savings!, free!],
      mappings: [
        { lineId: home!.id, categoryId: "cat-groceries" },
        { lineId: rent!.id, categoryId: "cat-rent" },
      ],
    });
    // Logical deletes (D8): Home was removed, Rent's mapping was replaced, and Pedro left the space.
    plans.lines = plans.lines.map((r) => (r.line.id === home!.id ? { ...r, deletedAt: NOW } : r));
    plans.mappings = plans.mappings.map((r) =>
      r.mapping.categoryId === "cat-rent" ? { ...r, unmappedAt: NOW } : r,
    );
    await spaces.markLeft(HOUSEHOLD, "member-pedro", "GUEST", NOW);
    spending.byCategory = [
      { categoryId: "cat-groceries", amount: 30_000_000n },
      { categoryId: "cat-rent", amount: 90_000_000n },
    ];
    const view = unwrap(
      await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id }),
    );
    expect(view.figures.lines.map((l) => [l.line.name, l.spent])).toEqual([
      ["Rent", 0n],
      ["Savings", 0n],
      ["Free", 120_000_000n],
    ]);
    expect(view.figures.planned).toBe(253_000_000n);
    expect(view.figures.capacities.map((c) => [c.memberId, c.amount])).toEqual([
      ["member-ana", 160_000_000n],
      ["member-juan", 0n],
      ["member-sofi", 0n],
    ]);
    expect(view.figures.totalCapacity).toBe(160_000_000n);
  });

  it("answers BudgetPlanNotFound for unknown ids and another space's plan, and SpaceNotFound to Marta", async () => {
    const { deps } = budgetingWorld();
    const personal = unwrap(await createCreateBudgetPlan(deps)(as("u-ana", "2026-11", "space-ana"))).plan;
    const read = createGetBudgetPlan(deps);
    expect(codeOf(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId: personal.id }))).toBe(
      "BudgetPlanNotFound",
    );
    expect(codeOf(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId: "budget-404" }))).toBe(
      "BudgetPlanNotFound",
    );
    expect(codeOf(await read({ spaceId: "space-ana", userId: "u-marta", planId: personal.id }))).toBe(
      "SpaceNotFound",
    );
  });

  it("reads the plans of an archived space (HU-E1-09)", async () => {
    const { deps, spaces } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    spaces.archived.add(HOUSEHOLD);
    const read = await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-juan", planId: plan.id });
    expect(codeOf(read)).toBe("ok");
  });
});

describe("planForWrite (spec 7, every plan write)", () => {
  const write = (userId: string, planId: string, expectedVersion: number | null = null) => ({
    spaceId: HOUSEHOLD,
    userId,
    planId,
    expectedVersion,
  });

  it("bumps the version, honouring If-Match, and returns the members and parts as committed", async () => {
    const { deps, plans } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    plans.seed(plan.id, { lines: referenceLines() });
    const first = unwrap(await planForWrite(deps, write("u-ana", plan.id, 1)));
    expect([first.plan.version, first.members.length, first.parts.lines.length]).toEqual([2, 4, 4]);
    expect(unwrap(await planForWrite(deps, write("u-ana", plan.id))).plan.version).toBe(3);
  });

  it("refuses a stale If-Match, Juan the MEMBER, an unknown plan and an archived space", async () => {
    const { deps, spaces } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    expect(codeOf(await planForWrite(deps, write("u-ana", plan.id, 7)))).toBe("PreconditionFailed");
    expect(codeOf(await planForWrite(deps, write("u-juan", plan.id)))).toBe("InsufficientRole");
    expect(codeOf(await planForWrite(deps, write("u-ana", "budget-404")))).toBe("BudgetPlanNotFound");
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await planForWrite(deps, write("u-ana", plan.id)))).toBe("SpaceArchived");
  });

  it("hides the space from Marta and refuses Sofi the VIEWER, before the plan or its lock is touched", async () => {
    const { deps, plans } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    expect(codeOf(await planForWrite(deps, write("u-marta", plan.id)))).toBe("SpaceNotFound");
    expect(codeOf(await planForWrite(deps, write("u-sofi", plan.id)))).toBe("InsufficientRole");
    expect(codeOf(await planForWrite(deps, write("u-marta", "budget-404")))).toBe("SpaceNotFound");
    expect(plans.plans.map((p) => p.version)).toEqual([1]);
  });

  it("leaves the version alone when the write is refused", async () => {
    const { deps, plans, spaces } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    await planForWrite(deps, write("u-ana", plan.id, 7));
    await planForWrite(deps, write("u-juan", plan.id));
    spaces.archived.add(HOUSEHOLD);
    await planForWrite(deps, write("u-ana", plan.id));
    expect(plans.plans.map((p) => p.version)).toEqual([1]);
  });

  it("applies the authorization rule a use case passes instead of plan.manage", async () => {
    const { deps } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    const ownCapacity = (m: Parameters<typeof requirePermission>[0]) =>
      requirePermission(m, "capacity.setOwn");
    expect(codeOf(await planForWrite(deps, write("u-juan", plan.id), ownCapacity))).toBe("ok");
    expect(codeOf(await planForWrite(deps, write("u-sofi", plan.id), ownCapacity))).toBe("InsufficientRole");
  });
});
